import { Router } from 'express';
import { audit, Db, localDate, one, pool, q, TODAY, tx } from './db';
import { auth, HttpError, int, MANAGERS, need, normPhone, normPlate, optText, STAFF, text } from './auth';

export const ordenes = Router();

const ORDER_SELECT = `
  select o.id, 'CS-' || lpad(o.number::text, 6, '0') as code, o.status, o.total, o.notes,
    o.created_at, o.started_at, o.finished_at, o.ready_at, o.delivered_at, o.cancel_reason,
    b.id as bike_id, b.plate, b.brand, b.model, b.color,
    c.id as customer_id, c.name as customer_name, c.phone as customer_phone,
    s.name as service_name, s.min_minutes, s.max_minutes, s.steps,
    w.id as washer_id, w.name as washer_name,
    (select coalesce(json_agg(json_build_object('id', i.id, 'name', i.name, 'price', i.price, 'kind', i.kind) order by i.kind, i.name), '[]'::json)
       from order_items i where i.order_id = o.id) as items,
    (select p.id from payments p where p.order_id = o.id and p.void_status is distinct from 'APPROVED' limit 1) as payment_id
  from orders o
  join bikes b on b.id = o.bike_id
  join customers c on c.id = o.customer_id
  join services s on s.id = o.service_id
  left join users w on w.id = o.washer_id`;

const ACTIVE = `('WAITING', 'WASHING', 'REVIEW', 'READY')`;

async function loadOrder(id: string, db: Db = pool) {
  const o = await one(`${ORDER_SELECT} where o.id = $1`, [id], db);
  if (!o) throw new HttpError(404, 'Orden no encontrada.');
  return o;
}

async function refreshTotal(orderId: string, db: Db) {
  await db.query('update orders set total = (select coalesce(sum(price), 0) from order_items where order_id = $1) where id = $1', [orderId]);
}

export async function openShift(db: Db = pool) {
  return one('select * from shifts where closed_at is null', [], db);
}

// ---- Clientes y motos ----

ordenes.get('/bikes/lookup', auth(...MANAGERS), async (req, res) => {
  const plate = normPlate(req.query.plate);
  const bike = await one(
    `select b.*, c.name as customer_name, c.phone as customer_phone,
       (select count(*) from orders o where o.bike_id = b.id and o.status = 'DELIVERED') as visits,
       (select json_build_object('service', s.name, 'date', o.delivered_at)
          from orders o join services s on s.id = o.service_id
          where o.bike_id = b.id and o.status = 'DELIVERED' order by o.delivered_at desc limit 1) as last_visit
     from bikes b join customers c on c.id = b.customer_id where b.plate = $1`,
    [plate],
  );
  res.json(bike ?? null);
});

ordenes.get('/customers', auth(...MANAGERS), async (req, res) => {
  const term = `%${String(req.query.q ?? '').trim()}%`;
  res.json(
    await q(
      `select c.id, c.name, c.phone,
         (select string_agg(b.plate, ', ') from bikes b where b.customer_id = c.id) as plates,
         count(o.id) filter (where o.status = 'DELIVERED') as visits,
         coalesce(sum(o.total) filter (where o.status = 'DELIVERED'), 0) as spent,
         max(o.delivered_at) as last_visit
       from customers c left join orders o on o.customer_id = c.id
       where c.name ilike $1 or c.phone ilike $1
          or exists (select 1 from bikes b where b.customer_id = c.id and b.plate ilike $1)
       group by c.id order by max(o.created_at) desc nulls last, c.name limit 100`,
      [term],
    ),
  );
});

ordenes.get('/customers/:id', auth(...MANAGERS), async (req, res) => {
  const customer = await one('select * from customers where id = $1', [req.params.id]);
  need(customer, 'Cliente no encontrado.', 404);
  const bikes = await q('select * from bikes where customer_id = $1 order by created_at', [customer.id]);
  const orders = await q(`${ORDER_SELECT} where o.customer_id = $1 order by o.created_at desc limit 100`, [customer.id]);
  res.json({ customer, bikes, orders });
});

ordenes.patch('/customers/:id', auth(...MANAGERS), async (req, res) => {
  const b = req.body ?? {};
  const phone = normPhone(b.phone) || null;
  need(!phone || !(await one('select 1 from customers where phone = $1 and id <> $2', [phone, req.params.id])), 'Otro cliente ya tiene ese celular.', 409);
  await q('update customers set name = $2, phone = $3, email = $4, document = $5 where id = $1', [
    req.params.id, text(b.name, 'el nombre', 80), phone, optText(b.email, 120), optText(b.document, 30),
  ]);
  res.json({ ok: true });
});

// Motos del cliente que agenda desde su celular
ordenes.get('/my/bikes', auth('CLIENT'), async (req, res) => {
  res.json(await q('select id, plate, brand, model, color from bikes where customer_id = $1 order by created_at', [req.user.customerId]));
});

ordenes.post('/my/bikes', auth('CLIENT'), async (req, res) => {
  const plate = normPlate(req.body?.plate);
  need(plate.length >= 5 && plate.length <= 7, 'Revisa la placa.');
  need(!(await one('select 1 from bikes where plate = $1', [plate])), 'Esa placa ya está registrada. Si es tuya, dilo en el local para asociarla.', 409);
  res.status(201).json(
    await one('insert into bikes (customer_id, plate, brand, model, color) values ($1, $2, $3, $4, $5) returning id, plate, brand, model, color', [
      req.user.customerId, plate, optText(req.body?.brand, 40), optText(req.body?.model, 40), optText(req.body?.color, 30),
    ]),
  );
});

// ---- Órdenes ----

ordenes.get('/orders', auth(...STAFF), async (req, res) => {
  const scope = String(req.query.scope ?? 'active');
  if (req.user.role === 'WASHER' || scope === 'mine') {
    // El lavador solo ve lo suyo: lo activo y lo que terminó hoy
    return res.json(
      await q(
        `${ORDER_SELECT} where o.washer_id = $1 and (o.status in ('WAITING', 'WASHING') or ${localDate('o.created_at')} = ${TODAY})
         order by case o.status when 'WASHING' then 0 when 'WAITING' then 1 else 2 end, o.created_at`,
        [req.user.id],
      ),
    );
  }
  const where =
    scope === 'today'
      ? `where o.status in ('DELIVERED', 'CANCELLED') and ${localDate('coalesce(o.delivered_at, o.cancelled_at)')} = ${TODAY}`
      : `where o.status in ${ACTIVE}`;
  res.json(await q(`${ORDER_SELECT} ${where} order by o.created_at`));
});

ordenes.get('/orders/:id', auth(...STAFF), async (req, res) => {
  const o = await loadOrder(String(req.params.id));
  need(req.user.role !== 'WASHER' || o.washer_id === req.user.id, 'Esta moto no está asignada a ti.', 403);
  const photos = await q(`select id, 'data:' || mime || ';base64,' || encode(data, 'base64') as url from order_photos where order_id = $1 order by created_at`, [o.id]);
  res.json({ ...o, photos });
});

const MAX_PHOTOS = 6;
const MAX_PHOTO_BYTES = 1_500_000;

ordenes.post('/orders', auth(...MANAGERS), async (req, res) => {
  const b = req.body ?? {};
  const plate = normPlate(b.plate);
  need(plate.length >= 5 && plate.length <= 7, 'Revisa la placa.');
  const extraIds: string[] = Array.isArray(b.extraIds) ? b.extraIds.map(String) : [];
  const photos: string[] = Array.isArray(b.photos) ? b.photos.slice(0, MAX_PHOTOS) : [];

  const id = await tx(async (c) => {
    let bike = await one('select * from bikes where plate = $1', [plate], c);
    if (!bike) {
      const name = text(b.customerName, 'el nombre del cliente', 80);
      const phone = normPhone(b.customerPhone) || null;
      let customer = phone ? await one('select id from customers where phone = $1', [phone], c) : undefined;
      if (!customer) customer = await one('insert into customers (name, phone) values ($1, $2) returning id', [name, phone], c);
      bike = await one(
        'insert into bikes (customer_id, plate, brand, model, color, year) values ($1, $2, $3, $4, $5, $6) returning *',
        [customer.id, plate, optText(b.brand, 40), optText(b.model, 40), optText(b.color, 30), b.year ? int(b.year, 'El año', 1950) : null],
        c,
      );
    }
    const base = await one(`select * from services where id = $1 and kind = 'BASE' and active`, [String(b.serviceId)], c);
    need(base, 'Elige el servicio.');
    const extras = extraIds.length ? await q(`select * from services where id = any($1::uuid[]) and kind = 'EXTRA' and active`, [extraIds], c) : [];
    need(extras.length === extraIds.length, 'Uno de los adicionales ya no está disponible.');

    let washerId: string | null = null;
    if (b.washerId) {
      const w = await one(`select id from users where id = $1 and active and role <> 'CLIENT'`, [String(b.washerId)], c);
      need(w, 'Ese lavador no está disponible.');
      washerId = w.id;
    }
    const total = base.price + extras.reduce((a, e) => a + e.price, 0);
    const order = await one(
      `insert into orders (customer_id, bike_id, service_id, booking_id, washer_id, notes, total, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
      [bike.customer_id, bike.id, base.id, b.bookingId || null, washerId, optText(b.notes, 1000), total, req.user.id],
      c,
    );
    for (const s of [base, ...extras]) {
      await c.query('insert into order_items (order_id, service_id, name, kind, price) values ($1, $2, $3, $4, $5)', [order.id, s.id, s.name, s.kind, s.price]);
    }
    for (const p of photos) {
      const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(String(p));
      need(m, 'Una de las fotos no se pudo leer.');
      const data = Buffer.from(m[2], 'base64');
      need(data.length <= MAX_PHOTO_BYTES, 'Una de las fotos pesa demasiado.');
      await c.query('insert into order_photos (order_id, mime, data) values ($1, $2, $3)', [order.id, m[1], data]);
    }
    if (b.bookingId) await c.query(`update bookings set status = 'ARRIVED' where id = $1`, [String(b.bookingId)]);
    await audit(req.user.id, 'ORDEN_CREADA', 'order', order.id, { placa: plate, total }, c);
    return order.id as string;
  });
  res.status(201).json(await loadOrder(id));
});

ordenes.post('/orders/:id/assign', auth(...MANAGERS), async (req, res) => {
  const o = await loadOrder(String(req.params.id));
  need(['WAITING', 'WASHING', 'REVIEW'].includes(o.status), 'Esta orden ya no se puede reasignar.');
  const w = await one(`select id, name from users where id = $1 and active and role <> 'CLIENT'`, [String(req.body?.washerId)]);
  need(w, 'Ese lavador no está disponible.');
  await q('update orders set washer_id = $2 where id = $1', [o.id, w.id]);
  await audit(req.user.id, 'ORDEN_ASIGNADA', 'order', o.id, { orden: o.code, lavador: w.name });
  res.json(await loadOrder(o.id));
});

ordenes.post('/orders/:id/status', auth(...STAFF), async (req, res) => {
  const o = await loadOrder(String(req.params.id));
  const to = String(req.body?.status);
  need(['WAITING', 'WASHING', 'REVIEW', 'READY'].includes(to), 'Estado no válido.');
  need(['WAITING', 'WASHING', 'REVIEW', 'READY'].includes(o.status), 'Esta orden ya está cerrada.');
  if (req.user.role === 'WASHER') {
    need(o.washer_id === req.user.id, 'Esta moto no está asignada a ti.', 403);
    const allowed = (o.status === 'WAITING' && to === 'WASHING') || (o.status === 'WASHING' && to === 'REVIEW');
    need(allowed, 'Ese cambio lo hace el administrador.', 403);
  }
  need(to === 'WAITING' || o.washer_id, 'Primero asigna un lavador.');
  await q(
    `update orders set status = $2,
       started_at = case when $2 = 'WASHING' then coalesce(started_at, now()) else started_at end,
       finished_at = case when $2 = 'REVIEW' then now() when $2 = 'READY' then coalesce(finished_at, now()) else finished_at end,
       ready_at = case when $2 = 'READY' then now() else ready_at end
     where id = $1`,
    [o.id, to],
  );
  await audit(req.user.id, 'ORDEN_ESTADO', 'order', o.id, { orden: o.code, de: o.status, a: to });
  res.json(await loadOrder(o.id));
});

ordenes.post('/orders/:id/items', auth(...MANAGERS), async (req, res) => {
  const o = await loadOrder(String(req.params.id));
  need(['WAITING', 'WASHING', 'REVIEW', 'READY'].includes(o.status) && !o.payment_id, 'Esta orden ya no admite cambios.');
  const s = await one(`select * from services where id = $1 and kind = 'EXTRA' and active`, [String(req.body?.serviceId)]);
  need(s, 'Adicional no disponible.');
  // Los adicionales "desde" (óxido, manchas) pueden cobrarse por encima del precio base, nunca por debajo
  const price = s.price_from && req.body?.price !== undefined ? int(req.body.price, 'El precio', s.price) : s.price;
  await tx(async (c) => {
    await c.query('insert into order_items (order_id, service_id, name, kind, price) values ($1, $2, $3, $4, $5)', [o.id, s.id, s.name, s.kind, price]);
    await refreshTotal(o.id, c);
    await audit(req.user.id, 'ADICIONAL_AGREGADO', 'order', o.id, { orden: o.code, adicional: s.name, precio: price }, c);
  });
  res.json(await loadOrder(o.id));
});

ordenes.delete('/orders/:id/items/:itemId', auth(...MANAGERS), async (req, res) => {
  const o = await loadOrder(String(req.params.id));
  need(['WAITING', 'WASHING', 'REVIEW', 'READY'].includes(o.status) && !o.payment_id, 'Esta orden ya no admite cambios.');
  await tx(async (c) => {
    const item = await one(`delete from order_items where id = $1 and order_id = $2 and kind = 'EXTRA' returning name, price`, [req.params.itemId, o.id], c);
    need(item, 'Ese adicional no está en la orden.', 404);
    await refreshTotal(o.id, c);
    await audit(req.user.id, 'ADICIONAL_QUITADO', 'order', o.id, { orden: o.code, adicional: item.name, precio: item.price }, c);
  });
  res.json(await loadOrder(o.id));
});

ordenes.post('/orders/:id/cancel', auth(...MANAGERS), async (req, res) => {
  const o = await loadOrder(String(req.params.id));
  need(['WAITING', 'WASHING', 'REVIEW', 'READY'].includes(o.status), 'Esta orden ya está cerrada.');
  need(!o.payment_id, 'Esta orden ya tiene un cobro. Primero hay que anularlo.');
  const reason = text(req.body?.reason, 'el motivo', 300);
  await q(`update orders set status = 'CANCELLED', cancelled_at = now(), cancel_reason = $2 where id = $1`, [o.id, reason]);
  await audit(req.user.id, 'ORDEN_CANCELADA', 'order', o.id, { orden: o.code, motivo: reason });
  res.json({ ok: true });
});

// ---- Cobros ----

const METHODS = ['EFECTIVO', 'NEQUI', 'DAVIPLATA', 'TRANSFERENCIA', 'DATAFONO'];

ordenes.post('/orders/:id/pay', auth(...MANAGERS), async (req, res) => {
  const b = req.body ?? {};
  const method = String(b.method);
  need(METHODS.includes(method), 'Elige cómo paga.');
  const tip = b.tip ? int(b.tip, 'La propina') : 0;
  const out = await tx(async (c) => {
    // Bloquea la orden para que dos toques seguidos no la cobren dos veces
    const locked = await one('select id from orders where id = $1 for update', [String(req.params.id)], c);
    need(locked, 'Orden no encontrada.', 404);
    const o = await loadOrder(locked.id, c);
    need(o.status === 'READY', 'Primero pasa la moto a "Lista para entregar".');
    need(!o.payment_id, 'Esta orden ya fue cobrada.', 409);
    const shift = await openShift(c);
    need(shift, 'No hay turno abierto. Abre la caja antes de cobrar.');
    let cash: number | null = null;
    if (method === 'EFECTIVO') {
      const received = b.cashReceived === undefined || b.cashReceived === null ? o.total + tip : int(b.cashReceived, 'El efectivo recibido');
      need(received >= o.total + tip, 'El efectivo recibido no alcanza.');
      cash = received;
    }
    const p = await one(
      `insert into payments (order_id, shift_id, method, amount, tip, cash_received, reference, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
      [o.id, shift.id, method, o.total, tip, cash, optText(b.reference, 40), req.user.id],
      c,
    );
    await c.query(`update orders set status = 'DELIVERED', delivered_at = now() where id = $1`, [o.id]);
    await audit(req.user.id, 'COBRO', 'payment', p.id, { orden: o.code, medio: method, valor: o.total, propina: tip }, c);
    return { paymentId: p.id, change: cash === null ? 0 : cash - o.total - tip };
  });
  res.status(201).json(out);
});

ordenes.get('/payments', auth(...MANAGERS), async (req, res) => {
  const shift = await openShift();
  // Con turno abierto se muestran sus cobros; sin turno, los de hoy
  const where = shift ? 'p.shift_id = $1' : `${localDate('p.created_at')} = ${TODAY} and $1::text is null`;
  const rows = await q(
    `select p.id, p.method, p.amount, p.tip, p.created_at, p.void_status, p.void_reason,
       'CS-' || lpad(o.number::text, 6, '0') as code, o.id as order_id, b.plate, s.name as service_name,
       u.name as created_by_name, r.name as void_requested_by_name
     from payments p
     join orders o on o.id = p.order_id join bikes b on b.id = o.bike_id join services s on s.id = o.service_id
     join users u on u.id = p.created_by left join users r on r.id = p.void_requested_by
     where ${where} or p.void_status = 'REQUESTED'
     order by p.created_at desc`,
    [shift ? shift.id : null],
  );
  res.json(rows);
});

/** El cobro no se borra: queda anulado y la moto vuelve a "Lista para entregar". */
async function reopenOrder(orderId: string, db: Db) {
  await db.query(`update orders set status = 'READY', delivered_at = null where id = $1 and status = 'DELIVERED'`, [orderId]);
}

// El administrador pide la anulación; el propietario la aplica de una vez
ordenes.post('/payments/:id/void', auth(...MANAGERS), async (req, res) => {
  const reason = text(req.body?.reason, 'el motivo', 300);
  const p = await one('select * from payments where id = $1', [req.params.id]);
  need(p, 'Cobro no encontrado.', 404);
  need(p.void_status !== 'APPROVED', 'Este cobro ya está anulado.');
  need(p.void_status !== 'REQUESTED', 'Ya hay una solicitud esperando al propietario.');
  const owner = req.user.role === 'OWNER';
  await tx(async (c) => {
    await c.query(
      `update payments set void_status = $2, void_reason = $3, void_requested_by = $4, void_requested_at = now(),
         void_resolved_by = $5, void_resolved_at = case when $5::uuid is null then null else now() end
       where id = $1`,
      [p.id, owner ? 'APPROVED' : 'REQUESTED', reason, req.user.id, owner ? req.user.id : null],
    );
    if (owner) await reopenOrder(p.order_id, c);
    await audit(req.user.id, owner ? 'COBRO_ANULADO' : 'ANULACION_SOLICITADA', 'payment', p.id, { motivo: reason, valor: p.amount }, c);
  });
  res.json({ status: owner ? 'APPROVED' : 'REQUESTED' });
});

ordenes.post('/payments/:id/void-resolve', auth('OWNER'), async (req, res) => {
  const approve = !!req.body?.approve;
  const p = await one('select * from payments where id = $1', [req.params.id]);
  need(p && p.void_status === 'REQUESTED', 'No hay una solicitud pendiente para este cobro.', 404);
  await tx(async (c) => {
    await c.query('update payments set void_status = $2, void_resolved_by = $3, void_resolved_at = now() where id = $1', [
      p.id, approve ? 'APPROVED' : 'REJECTED', req.user.id,
    ]);
    if (approve) await reopenOrder(p.order_id, c);
    await audit(req.user.id, approve ? 'COBRO_ANULADO' : 'ANULACION_RECHAZADA', 'payment', p.id, { motivo: p.void_reason, valor: p.amount }, c);
  });
  res.json({ status: approve ? 'APPROVED' : 'REJECTED' });
});
