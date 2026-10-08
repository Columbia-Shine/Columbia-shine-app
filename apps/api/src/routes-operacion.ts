import { Router } from 'express';
import { audit, Db, localDate, one, pool, q, setting, TODAY, tx } from './db';
import { auth, int, MANAGERS, need, normPhone, optText, text } from './auth';
import { openShift } from './routes-ordenes';

export const operacion = Router();

const VALID_PAYMENT = `p.void_status is distinct from 'APPROVED'`;

// ---- Caja y turnos ----

async function shiftSummary(shiftId: string, db: Db = pool) {
  const shift = await one(
    `select s.*, u.name as opened_by_name from shifts s join users u on u.id = s.opened_by where s.id = $1`,
    [shiftId],
    db,
  );
  const byMethod = await q(
    `select p.method, count(*) as n, sum(p.amount) as amount, sum(p.tip) as tips
     from payments p where p.shift_id = $1 and ${VALID_PAYMENT} group by p.method order by sum(p.amount) desc`,
    [shiftId],
    db,
  );
  const movements = await q(
    `select m.id, m.kind, m.amount, m.description, m.created_at, u.name as user_name
     from cash_movements m join users u on u.id = m.created_by where m.shift_id = $1 order by m.created_at`,
    [shiftId],
    db,
  );
  const byService = await q(
    `select i.name, i.kind, count(*) as n, sum(i.price) as amount
     from payments p join order_items i on i.order_id = p.order_id
     where p.shift_id = $1 and ${VALID_PAYMENT} group by i.name, i.kind order by i.kind, sum(i.price) desc`,
    [shiftId],
    db,
  );
  const pct = await setting('commission_pct', 45);
  const washers = await q(
    `select w.id, w.name, count(*) as n, sum(p.amount) as washed
     from payments p join orders o on o.id = p.order_id join users w on w.id = o.washer_id
     where p.shift_id = $1 and ${VALID_PAYMENT} group by w.id, w.name order by sum(p.amount) desc`,
    [shiftId],
    db,
  );
  const sum = (rows: any[], key: string) => rows.reduce((a, r) => a + Number(r[key]), 0);
  const sales = sum(byMethod, 'amount');
  const tips = sum(byMethod, 'tips');
  const cash = byMethod.find((m) => m.method === 'EFECTIVO');
  const cashIn = cash ? Number(cash.amount) + Number(cash.tips) : 0;
  const mov = (kind: string) => sum(movements.filter((m) => m.kind === kind), 'amount');
  const expectedCash = shift.opening_cash + cashIn + mov('ENTRADA') - mov('GASTO') - mov('RETIRO');
  // Propinas: se reparten por igual entre quienes lavaron en el turno
  const tipEach = washers.length ? Math.floor(tips / washers.length) : 0;
  const payroll = washers.map((w) => {
    const commission = Math.round((Number(w.washed) * pct) / 100);
    return { id: w.id, name: w.name, n: Number(w.n), washed: Number(w.washed), commission, tip: tipEach, total: commission + tipEach };
  });
  const pending = await one(`select count(*) as n from orders where status in ('WAITING', 'WASHING', 'REVIEW', 'READY')`, [], db);
  return {
    shift, byMethod, byService, movements, payroll,
    commissionPct: pct,
    sales, tips,
    bikes: sum(byMethod, 'n'),
    expenses: mov('GASTO'), withdrawals: mov('RETIRO'), deposits: mov('ENTRADA'),
    cashSales: cashIn, expectedCash,
    pendingOrders: Number(pending.n),
  };
}

operacion.get('/shifts/current', auth(...MANAGERS), async (_req, res) => {
  const shift = await openShift();
  res.json(shift ? await shiftSummary(shift.id) : null);
});

operacion.post('/shifts/open', auth(...MANAGERS), async (req, res) => {
  need(!(await openShift()), 'Ya hay un turno abierto.', 409);
  const openingCash = int(req.body?.openingCash, 'La base de caja');
  const s = await one('insert into shifts (opened_by, opening_cash) values ($1, $2) returning id', [req.user.id, openingCash]);
  await audit(req.user.id, 'TURNO_ABIERTO', 'shift', s.id, { base: openingCash });
  res.status(201).json(await shiftSummary(s.id));
});

operacion.post('/shifts/movements', auth(...MANAGERS), async (req, res) => {
  const shift = await openShift();
  need(shift, 'No hay turno abierto.');
  const kind = String(req.body?.kind);
  need(['GASTO', 'RETIRO', 'ENTRADA'].includes(kind), 'Tipo de movimiento no válido.');
  const amount = int(req.body?.amount, 'El valor', 1);
  const description = text(req.body?.description, 'la descripción', 200);
  const m = await one('insert into cash_movements (shift_id, kind, amount, description, created_by) values ($1, $2, $3, $4, $5) returning id', [
    shift.id, kind, amount, description, req.user.id,
  ]);
  await audit(req.user.id, 'MOVIMIENTO_CAJA', 'cash_movement', m.id, { tipo: kind, valor: amount, descripcion: description });
  res.status(201).json(await shiftSummary(shift.id));
});

operacion.post('/shifts/close', auth(...MANAGERS), async (req, res) => {
  const counted = int(req.body?.countedCash, 'El efectivo contado');
  const note = optText(req.body?.note, 500);
  const id = await tx(async (c) => {
    const shift = await one('select * from shifts where closed_at is null for update', [], c);
    need(shift, 'No hay turno abierto.');
    const s = await shiftSummary(shift.id, c);
    const difference = counted - s.expectedCash;
    need(difference === 0 || note, 'Hay una diferencia de caja: escribe la explicación.');
    await c.query(
      `update shifts set closed_at = now(), closed_by = $2, expected_cash = $3, counted_cash = $4, difference = $5, difference_note = $6 where id = $1`,
      [shift.id, req.user.id, s.expectedCash, counted, difference, note],
    );
    await audit(req.user.id, 'TURNO_CERRADO', 'shift', shift.id, { esperado: s.expectedCash, contado: counted, diferencia: difference, nota: note }, c);
    return shift.id as string;
  });
  res.json(await shiftSummary(id));
});

operacion.get('/shifts/history', auth('OWNER'), async (_req, res) => {
  res.json(
    await q(
      `select s.id, s.opened_at, s.closed_at, s.opening_cash, s.expected_cash, s.counted_cash, s.difference, s.difference_note,
         u.name as opened_by_name,
         (select coalesce(sum(p.amount), 0) from payments p where p.shift_id = s.id and ${VALID_PAYMENT}) as sales
       from shifts s join users u on u.id = s.opened_by order by s.opened_at desc limit 30`,
    ),
  );
});

operacion.get('/shifts/:id', auth('OWNER'), async (req, res) => {
  need(await one('select 1 from shifts where id = $1', [req.params.id]), 'Turno no encontrado.', 404);
  res.json(await shiftSummary(String(req.params.id)));
});

// ---- Inicio ----

operacion.get('/dashboard', auth(...MANAGERS), async (req, res) => {
  const today = await one(
    `select coalesce(sum(p.amount), 0) as sales, count(*) as bikes
     from payments p where ${localDate('p.created_at')} = ${TODAY} and ${VALID_PAYMENT}`,
  );
  const active = await q(
    `select o.id, 'CS-' || lpad(o.number::text, 6, '0') as code, o.status, o.total, o.washer_id, b.plate, b.brand, b.model,
       s.name as service_name, s.max_minutes,
       extract(epoch from now() - coalesce(o.started_at, o.created_at))::int / 60 as minutes,
       extract(epoch from now() - o.ready_at)::int / 60 as ready_minutes
     from orders o join bikes b on b.id = o.bike_id join services s on s.id = o.service_id
     where o.status in ('WAITING', 'WASHING', 'REVIEW', 'READY') order by o.created_at`,
  );
  const byService = await q(
    `select i.name, count(*) as n, sum(i.price) as amount
     from payments p join order_items i on i.order_id = p.order_id
     where ${localDate('p.created_at')} = ${TODAY} and ${VALID_PAYMENT} and i.kind = 'BASE' group by i.name order by sum(i.price) desc`,
  );
  const byMethod = await q(
    `select p.method, sum(p.amount) as amount from payments p
     where ${localDate('p.created_at')} = ${TODAY} and ${VALID_PAYMENT} group by p.method order by sum(p.amount) desc`,
  );
  const team = await q(
    `select u.id, u.name,
       (select count(*) from orders o where o.washer_id = u.id and o.status = 'DELIVERED' and ${localDate('o.delivered_at')} = ${TODAY}) as done,
       (select count(*) from orders o where o.washer_id = u.id and o.status in ('WAITING', 'WASHING')) as in_progress
     from users u where u.active and u.role in ('WASHER', 'ADMIN') order by u.name`,
  );
  const voidRequests = req.user.role === 'OWNER' ? Number((await one(`select count(*) as n from payments where void_status = 'REQUESTED'`)).n) : 0;
  const bookings = await q(
    `select k.id, k.starts_at, c.name as customer_name, c.phone, b.plate, s.name as service_name
     from bookings k join customers c on c.id = k.customer_id left join bikes b on b.id = k.bike_id join services s on s.id = k.service_id
     where k.status = 'BOOKED' and ${localDate('k.starts_at')} = ${TODAY} order by k.starts_at`,
  );
  const shift = await openShift();
  const sales = Number(today.sales);
  const bikes = Number(today.bikes);
  res.json({
    sales, bikes, ticket: bikes ? Math.round(sales / bikes) : 0,
    active, byService, byMethod, team, voidRequests, bookings,
    shift: shift ? { id: shift.id, opened_at: shift.opened_at } : null,
  });
});

// ---- Agenda ----

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{1,2}:00$/;

/** Horario del manual: lunes a viernes 10:00–7:30 p. m.; fin de semana 9:00–5:30 p. m. */
function slotHours(date: string): number[] {
  const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
  const weekend = dow === 0 || dow === 6;
  const [from, to] = weekend ? [9, 16] : [10, 18];
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

async function slots(date: string, db: Db = pool) {
  const capacity = await setting('slot_capacity', 2);
  const taken = await q(
    `select extract(hour from starts_at at time zone 'America/Bogota')::int as h, count(*) as n
     from bookings where status = 'BOOKED' and ${localDate('starts_at')} = $1::date group by 1`,
    [date],
    db,
  );
  const now = await one(`select ${TODAY}::text as d, extract(hour from now() at time zone 'America/Bogota')::int as h`, [], db);
  return slotHours(date).map((h) => {
    const used = Number(taken.find((t) => t.h === h)?.n ?? 0);
    const past = date < now.d || (date === now.d && h <= now.h);
    return { time: `${h}:00`, free: past ? 0 : Math.max(capacity - used, 0) };
  });
}

operacion.get('/bookings/slots', auth(), async (req, res) => {
  const date = String(req.query.date);
  need(DAY.test(date), 'Fecha no válida.');
  res.json(await slots(date));
});

operacion.get('/bookings', auth(), async (req, res) => {
  const base = `
    select k.id, k.starts_at, k.status, c.id as customer_id, c.name as customer_name, c.phone,
      b.id as bike_id, b.plate, b.brand, b.model, s.id as service_id, s.name as service_name, s.price
    from bookings k join customers c on c.id = k.customer_id
    left join bikes b on b.id = k.bike_id join services s on s.id = k.service_id`;
  if (req.user.role === 'CLIENT') {
    return res.json(await q(`${base} where k.customer_id = $1 and k.status = 'BOOKED' and k.starts_at > now() - interval '2 hours' order by k.starts_at`, [req.user.customerId]));
  }
  need(req.user.role !== 'WASHER', 'Tu usuario no tiene permiso para hacer esto.', 403);
  res.json(await q(`${base} where k.status = 'BOOKED' and ${localDate('k.starts_at')} >= ${TODAY} order by k.starts_at limit 200`));
});

const MAX_PER_DAY = 2;

operacion.post('/bookings', auth('OWNER', 'ADMIN', 'CLIENT'), async (req, res) => {
  const b = req.body ?? {};
  const date = String(b.date);
  const time = String(b.time);
  need(DAY.test(date) && TIME.test(time), 'Elige día y hora.');
  const client = req.user.role === 'CLIENT';
  const id = await tx(async (c) => {
    // Un candado por día evita que dos personas tomen el último cupo a la vez
    await c.query('select pg_advisory_xact_lock(hashtext($1))', [`booking:${date}`]);
    const range = await one(`select $1::date between ${TODAY} and ${TODAY} + 30 as ok`, [date], c);
    need(range.ok, 'Solo se puede agendar dentro de los próximos 30 días.');
    const slot = (await slots(date, c)).find((s) => s.time === time);
    need(slot && slot.free > 0, 'Esa hora ya no está disponible. Elige otra.', 409);
    const service = await one(`select id from services where id = $1 and kind = 'BASE' and active`, [String(b.serviceId)], c);
    need(service, 'Elige el servicio.');

    let customerId: string;
    if (client) {
      customerId = req.user.customerId as string;
      const mine = await one(`select count(*) as n from bookings where customer_id = $1 and status = 'BOOKED' and starts_at > now()`, [customerId], c);
      need(Number(mine.n) < 3, 'Ya tienes 3 reservas activas. Cancela una para agendar otra.');
      // Evita que una cuenta acapare los cupos de un día
      const sameDay = await one(
        `select count(*) as n from bookings where customer_id = $1 and status = 'BOOKED' and ${localDate('starts_at')} = $2::date`,
        [customerId, date],
        c,
      );
      need(Number(sameDay.n) < MAX_PER_DAY, `Solo puedes agendar ${MAX_PER_DAY} lavadas para un mismo día.`);
    } else if (b.customerId) {
      customerId = String(b.customerId);
      need(await one('select 1 from customers where id = $1', [customerId], c), 'Cliente no encontrado.', 404);
    } else {
      const name = text(b.customerName, 'el nombre del cliente', 80);
      const phone = normPhone(b.customerPhone);
      need(phone.length === 10, 'Escribe el celular de 10 dígitos.');
      const existing = await one('select id from customers where phone = $1', [phone], c);
      customerId = existing ? existing.id : (await one('insert into customers (name, phone) values ($1, $2) returning id', [name, phone], c)).id;
    }
    let bikeId: string | null = null;
    if (b.bikeId) {
      const bike = await one('select id from bikes where id = $1 and customer_id = $2', [String(b.bikeId), customerId], c);
      need(bike, 'Esa moto no pertenece a este cliente.');
      bikeId = bike.id;
    }
    const k = await one(
      `insert into bookings (customer_id, bike_id, service_id, starts_at, created_by)
       values ($1, $2, $3, ($4::date + $5::time) at time zone 'America/Bogota', $6) returning id`,
      [customerId, bikeId, service.id, date, time, req.user.id],
      c,
    );
    await audit(req.user.id, 'RESERVA_CREADA', 'booking', k.id, { fecha: date, hora: time }, c);
    return k.id as string;
  });
  res.status(201).json({ id });
});

operacion.post('/bookings/:id/cancel', auth('OWNER', 'ADMIN', 'CLIENT'), async (req, res) => {
  const k = await one('select * from bookings where id = $1', [req.params.id]);
  need(k && k.status === 'BOOKED', 'Reserva no encontrada.', 404);
  need(req.user.role !== 'CLIENT' || k.customer_id === req.user.customerId, 'Esta reserva no es tuya.', 403);
  await q(`update bookings set status = 'CANCELLED' where id = $1`, [k.id]);
  await audit(req.user.id, 'RESERVA_CANCELADA', 'booking', k.id);
  res.json({ ok: true });
});

// ---- Reportes ----

operacion.get('/reports', auth(...MANAGERS), async (req, res) => {
  const owner = req.user.role === 'OWNER';
  const today = (await one(`select ${TODAY}::text as d`)).d as string;
  // El administrador de turno solo consulta el día de hoy
  const from = owner && DAY.test(String(req.query.from)) ? String(req.query.from) : today;
  const to = owner && DAY.test(String(req.query.to)) ? String(req.query.to) : today;
  need(from <= to, 'El rango de fechas no es válido.');
  const P = [from, to];
  const inRange = `${localDate('p.created_at')} between $1::date and $2::date and ${VALID_PAYMENT}`;

  const totals = await one(`select coalesce(sum(p.amount), 0) as sales, coalesce(sum(p.tip), 0) as tips, count(*) as bikes from payments p where ${inRange}`, P);
  const byDay = await q(
    `select ${localDate('p.created_at')}::text as day, sum(p.amount) as sales, count(*) as bikes
     from payments p where ${inRange} group by 1 order by 1`,
    P,
  );
  const byMethod = await q(`select p.method, sum(p.amount) as amount, count(*) as n from payments p where ${inRange} group by p.method order by sum(p.amount) desc`, P);
  const byService = await q(
    `select i.name, i.kind, count(*) as n, sum(i.price) as sales, max(s.direct_cost) as unit_cost,
       max(s.min_minutes) as min_minutes, max(s.max_minutes) as max_minutes,
       round(avg(extract(epoch from o.finished_at - o.started_at) / 60) filter (where i.kind = 'BASE' and o.started_at is not null and o.finished_at is not null)) as avg_minutes
     from payments p join orders o on o.id = p.order_id join order_items i on i.order_id = o.id join services s on s.id = i.service_id
     where ${inRange} group by i.name, i.kind order by i.kind, sum(i.price) desc`,
    P,
  );
  const pct = await setting('commission_pct', 45);
  const byWasher = await q(
    `select w.name, count(*) as n, sum(p.amount) as washed,
       round(avg(extract(epoch from o.finished_at - o.started_at) / 60) filter (where o.started_at is not null and o.finished_at is not null)) as avg_minutes
     from payments p join orders o on o.id = p.order_id join users w on w.id = o.washer_id
     where ${inRange} group by w.name order by sum(p.amount) desc`,
    P,
  );
  const extra = await one(
    `select
       (select count(*) from orders o where o.status = 'CANCELLED' and ${localDate('o.cancelled_at')} between $1::date and $2::date) as cancelled,
       (select count(*) from payments p where p.void_status = 'APPROVED' and ${localDate('p.created_at')} between $1::date and $2::date) as voided,
       (select count(*) from customers c where ${localDate('c.created_at')} between $1::date and $2::date) as new_customers,
       (select coalesce(sum(m.amount), 0) from cash_movements m where m.kind = 'GASTO' and ${localDate('m.created_at')} between $1::date and $2::date) as expenses,
       (select coalesce(sum(abs(s.difference)), 0) from shifts s where s.closed_at is not null and ${localDate('s.closed_at')} between $1::date and $2::date) as cash_differences`,
    P,
  );
  const sales = Number(totals.sales);
  const bikes = Number(totals.bikes);
  const out: any = {
    from, to, sales, bikes, tips: Number(totals.tips), ticket: bikes ? Math.round(sales / bikes) : 0,
    byDay, byMethod,
    byService: byService.map((s) => ({
      name: s.name, kind: s.kind, n: Number(s.n), sales: Number(s.sales),
      min_minutes: s.min_minutes, max_minutes: s.max_minutes, avg_minutes: s.avg_minutes === null ? null : Number(s.avg_minutes),
    })),
    byWasher: byWasher.map((w) => ({
      name: w.name, n: Number(w.n), washed: Number(w.washed),
      commission: Math.round((Number(w.washed) * pct) / 100),
      avg_minutes: w.avg_minutes === null ? null : Number(w.avg_minutes),
    })),
    cancelled: Number(extra.cancelled), voided: Number(extra.voided), newCustomers: Number(extra.new_customers),
    expenses: Number(extra.expenses), cashDifferences: Number(extra.cash_differences),
  };
  if (owner) {
    // Rentabilidad: solo para el propietario. Costo directo del manual (producto + mano de obra de referencia).
    let cost = 0;
    out.byService.forEach((s: any, i: number) => {
      const unit = byService[i].unit_cost;
      s.unit_cost = unit;
      s.contribution = unit === null ? null : s.sales - s.n * unit;
      if (unit !== null) cost += s.n * unit;
    });
    out.commissionPct = pct;
    out.directCost = cost;
  }
  res.json(out);
});
