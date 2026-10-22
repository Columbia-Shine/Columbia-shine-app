import { Router } from 'express';
import { audit, one, q, TODAY, tx } from './db';
import { auth, int, MANAGERS, need, optText, text } from './auth';
import { activeMembership } from './membership';
import { openShift } from './routes-ordenes';

/** Membresías: planes, venta por placa (30 días) y lavados restantes. */
export const membresias = Router();

const SALE_METHODS = ['EFECTIVO', 'NEQUI', 'DAVIPLATA', 'TRANSFERENCIA', 'DATAFONO'];
const DAYS = 30;

// ---- Planes ----

membresias.get('/membership-plans', auth(...MANAGERS), async (req, res) => {
  res.json(
    await q(
      `select p.id, p.name, p.service_id, s.name as service_name, s.price as service_price, p.washes, p.price, p.active
       from membership_plans p join services s on s.id = p.service_id
       ${req.user.role === 'OWNER' ? '' : 'where p.active'} order by p.active desc, p.price`,
    ),
  );
});

membresias.post('/membership-plans', auth('OWNER'), async (req, res) => {
  const b = req.body ?? {};
  const name = text(b.name, 'el nombre del plan', 60);
  const service = await one(`select id, name from services where id = $1 and kind = 'BASE'`, [String(b.serviceId)]);
  need(service, 'Elige el servicio que incluye.');
  const washes = int(b.washes, 'Los lavados', 1);
  const price = int(b.price, 'El precio', 1);
  const p = await one(`insert into membership_plans (name, service_id, washes, price) values ($1, $2, $3, $4) returning id`, [name, service.id, washes, price]);
  await audit(req.user.id, 'PLAN_CREADO', 'membership_plan', p.id, { plan: name, servicio: service.name, lavados: washes, precio: price });
  res.status(201).json({ id: p.id });
});

membresias.patch('/membership-plans/:id', auth('OWNER'), async (req, res) => {
  const p = await one('select * from membership_plans where id = $1', [req.params.id]);
  need(p, 'Plan no encontrado.', 404);
  const b = req.body ?? {};
  const price = b.price === undefined ? p.price : int(b.price, 'El precio', 1);
  const washes = b.washes === undefined ? p.washes : int(b.washes, 'Los lavados', 1);
  const active = b.active === undefined ? p.active : !!b.active;
  await q('update membership_plans set price = $2, washes = $3, active = $4 where id = $1', [p.id, price, washes, active]);
  await audit(req.user.id, 'PLAN_EDITADO', 'membership_plan', p.id, { plan: p.name, precio: price, lavados: washes, activo: active });
  res.json({ ok: true });
});

// ---- Venta ----

membresias.get('/bikes/:id/membership', auth(...MANAGERS), async (req, res) => {
  res.json(await activeMembership(String(req.params.id)));
});

// Se vende para una placa: entra a la caja como cualquier cobro (sin orden) y dura 30 días
membresias.post('/memberships', auth(...MANAGERS), async (req, res) => {
  const b = req.body ?? {};
  const method = String(b.method);
  need(SALE_METHODS.includes(method), 'Elige cómo paga.');
  const out = await tx(async (c) => {
    const plan = await one('select * from membership_plans where id = $1 and active', [String(b.planId)], c);
    need(plan, 'Elige el plan.');
    const bike = await one('select b.*, c.pending from bikes b join customers c on c.id = b.customer_id where b.id = $1 for update of b', [String(b.bikeId)], c);
    need(bike, 'Moto no encontrada.', 404);
    need(!bike.pending, 'Primero completa los datos del cliente.');
    const current = await activeMembership(bike.id, c);
    need(!current || current.remaining === 0, `Esta moto ya tiene la membresía ${current?.name} vigente con ${current?.remaining} lavado(s).`);
    const shift = await openShift(c);
    need(shift, 'No hay turno abierto. Abre la caja antes de cobrar.');
    let cash: number | null = null;
    if (method === 'EFECTIVO') {
      cash = b.cashReceived === undefined || b.cashReceived === null || b.cashReceived === '' ? plan.price : int(b.cashReceived, 'El efectivo recibido');
      need(cash! >= plan.price, 'El efectivo recibido no alcanza.');
    }
    const m = await one(
      `insert into memberships (plan_id, bike_id, customer_id, name, service_id, washes, price, starts_on, ends_on, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, ${TODAY}, ${TODAY} + ${DAYS - 1}, $8) returning id, ends_on::text`,
      [plan.id, bike.id, bike.customer_id, plan.name, plan.service_id, plan.washes, plan.price, req.user.id],
      c,
    );
    const p = await one(
      `insert into payments (membership_id, shift_id, method, amount, tip, cash_received, reference, created_by) values ($1, $2, $3, $4, 0, $5, $6, $7) returning id`,
      [m.id, shift.id, method, plan.price, cash, method === 'EFECTIVO' ? null : optText(b.reference, 40), req.user.id],
      c,
    );
    await audit(req.user.id, 'MEMBRESIA_VENDIDA', 'payment', p.id, { plan: plan.name, placa: bike.plate, precio: plan.price, hasta: m.ends_on, medio: method }, c);
    return { paymentId: p.id, change: cash === null ? 0 : cash - plan.price };
  });
  res.status(201).json(out);
});
