import { Router } from 'express';
import { audit, Db, localDate, one, pool, q, setting, TODAY, tx } from './db';
import { auth, int, need, optText, WASHES } from './auth';
import { openShift } from './routes-ordenes';

const OUT_METHODS = ['NEQUI', 'DAVIPLATA', 'TRANSFERENCIA'];

/** Nómina diaria del equipo (comisión, propinas y acuerdos de mínimo). Solo el propietario. */
export const nomina = Router();

const VALID_PAYMENT = `p.void_status is distinct from 'APPROVED'`;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

type Guarantee = { id: string; base_no_wash: number; min_commission: number; max_topup: number | null; starts_on: string; ends_on: string };

/**
 * Ajuste del acuerdo: sin lavados se paga la base (si vino); con lavados se completa hasta el mínimo,
 * pero nunca más del tope (max_topup). Ej.: mínimo 75.000 y tope 30.000; con 40.000 de comisión se dan 30.000.
 */
export function topupFor(g: Guarantee | null, washes: number, commission: number, worked: boolean): number {
  if (!g) return 0;
  if (washes > 0) {
    const missing = Math.max(0, g.min_commission - commission);
    return g.max_topup === null ? missing : Math.min(missing, g.max_topup);
  }
  return worked ? g.base_no_wash : 0;
}

async function today(db: Db = pool): Promise<string> {
  return (await one(`select ${TODAY}::text as d`, [], db)).d;
}

/** Cifras de un día por persona: lo cobrado de las motos que lavó, su comisión, propinas y el acuerdo vigente. */
async function dayFigures(day: string, db: Db = pool) {
  const pct = await setting('commission_pct', 45);
  const staff = await q(`select id, name, role from users where active and ${WASHES()} order by name`, [], db);
  const washed = await q(
    `select o.washer_id as id, count(*) as n, sum(p.amount + p.covered) as washed
     from payments p join orders o on o.id = p.order_id
     where ${localDate('p.created_at')} = $1::date and ${VALID_PAYMENT} and o.washer_id is not null
     group by o.washer_id`,
    [day],
    db,
  );
  const tipsDay = Number((await one(`select coalesce(sum(p.tip), 0) as t from payments p where ${localDate('p.created_at')} = $1::date and ${VALID_PAYMENT}`, [day], db)).t);
  // Las propinas se reparten por igual entre quienes lavaron ese día
  const tipEach = washed.length ? Math.floor(tipsDay / washed.length) : 0;
  const guarantees = await q<Guarantee & { user_id: string }>(
    `select distinct on (user_id) id, user_id, base_no_wash, min_commission, max_topup, starts_on::text, ends_on::text
     from pay_guarantees where $1::date between starts_on and ends_on order by user_id, created_at desc`,
    [day],
    db,
  );
  const paid = await q(`select d.*, u.name as paid_by_name from payroll_days d join users u on u.id = d.paid_by where d.day = $1::date`, [day], db);

  const people = staff
    .map((u) => {
      const w = washed.find((x) => x.id === u.id);
      const washes = w ? Number(w.n) : 0;
      const sales = w ? Number(w.washed) : 0;
      const commission = Math.round((sales * pct) / 100);
      const tips = washes ? tipEach : 0;
      const g = guarantees.find((x) => x.user_id === u.id) ?? null;
      const topup = topupFor(g, washes, commission, false);
      return {
        id: u.id, name: u.name, role: u.role, washes, washed: sales, commission, tips, topup,
        total: commission + tips + topup,
        // Si no lavó, la base del acuerdo solo se paga si vino a trabajar
        baseIfWorked: g && washes === 0 ? g.base_no_wash : 0,
        guarantee: g,
        paid: paid.find((p) => p.user_id === u.id) ?? null,
      };
    })
    .filter((p) => p.washes > 0 || p.guarantee || p.paid);
  return { day, pct, people };
}

nomina.get('/payroll', auth('OWNER'), async (req, res) => {
  const day = DAY.test(String(req.query.day)) ? String(req.query.day) : await today();
  res.json(await dayFigures(day));
});

nomina.post('/payroll/pay', auth('OWNER'), async (req, res) => {
  const b = req.body ?? {};
  const day = String(b.day);
  need(DAY.test(day), 'Elige el día.');
  need(day <= (await today()), 'No se puede pagar un día que no ha pasado.');
  const out = await tx(async (c) => {
    // Un candado por persona y día evita registrar el mismo pago dos veces
    await c.query('select pg_advisory_xact_lock(hashtext($1))', [`payroll:${b.userId}:${day}`]);
    const fig = (await dayFigures(day, c)).people.find((p) => p.id === String(b.userId));
    need(fig, 'Esa persona no tiene nada por pagar ese día.');
    need(!fig.paid, 'Ese día ya está registrado como pagado.', 409);
    const worked = fig.washes > 0 || b.worked === true;
    const topup = topupFor(fig.guarantee, fig.washes, fig.commission, worked);
    const total = fig.commission + fig.tips + topup;
    need(total > 0, 'No hay nada por pagar ese día.');
    // Cómo se le pagó: efectivo de la caja (queda como retiro) y/o por Nequi u otro medio
    const cash = b.cash === undefined || b.cash === null ? 0 : int(b.cash, 'El efectivo');
    const other = total - cash;
    need(cash <= total, 'El efectivo no puede ser más que el total a pagar.');
    const otherMethod = other > 0 ? String(b.otherMethod ?? '') : null;
    need(!other || OUT_METHODS.includes(otherMethod!), 'Elige por qué medio pagaste el resto.');
    let movementId: string | null = null;
    if (cash > 0) {
      const shift = await openShift(c);
      need(shift, 'Para pagar con efectivo de la caja, abre el turno de caja.');
      movementId = (
        await one(
          `insert into cash_movements (shift_id, kind, amount, description, category, created_by) values ($1, 'RETIRO', $2, $3, 'Nómina', $4) returning id`,
          [shift.id, cash, `Nómina ${fig.name} ${day}`, req.user.id],
          c,
        )
      ).id;
    }
    const row = await one(
      `insert into payroll_days (user_id, day, washes, washed, commission, tips, topup, total, guarantee_id, note, paid_by, paid_cash, paid_other, other_method, cash_movement_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) returning id`,
      [fig.id, day, fig.washes, fig.washed, fig.commission, fig.tips, topup, total, fig.guarantee?.id ?? null, optText(b.note, 300), req.user.id, cash, other, otherMethod, movementId],
      c,
    );
    await audit(
      req.user.id, 'NOMINA_PAGADA', 'user', fig.id,
      { persona: fig.name, dia: day, comision: fig.commission, propinas: fig.tips, ajuste: topup, total, efectivo: cash, otro_medio: other ? `${otherMethod} ${other}` : null },
      c,
    );
    return row.id;
  });
  res.status(201).json({ id: out });
});

// Deshacer un pago mal registrado (por ejemplo, si después se anuló un cobro de ese día)
nomina.delete('/payroll/:id', auth('OWNER'), async (req, res) => {
  const d = await one(`select d.*, u.name from payroll_days d join users u on u.id = d.user_id where d.id = $1`, [req.params.id]);
  need(d, 'Pago no encontrado.', 404);
  // El retiro de caja se deshace solo si su turno sigue abierto; si ya cerró, queda en ese cierre
  const mov = d.cash_movement_id
    ? await one('select m.id, s.closed_at from cash_movements m join shifts s on s.id = m.shift_id where m.id = $1', [d.cash_movement_id])
    : null;
  await tx(async (c) => {
    await c.query('delete from payroll_days where id = $1', [d.id]);
    if (mov && !mov.closed_at) await c.query('delete from cash_movements where id = $1', [mov.id]);
    await audit(req.user.id, 'NOMINA_DESHECHA', 'user', d.user_id, { persona: d.name, dia: d.day, total: d.total, retiro_deshecho: !!(mov && !mov.closed_at) }, c);
  });
  res.json({ ok: true, cashKept: !!(mov && mov.closed_at) });
});

// ---- Mi mes: lo que lleva en el mes quien lava (el administrador también lava) ----

nomina.get('/my-month', auth('ADMIN', 'WASHER'), async (req, res) => {
  const pct = await setting('commission_pct', 45);
  const { from, to } = await one(`select date_trunc('month', ${TODAY})::date::text as from, ${TODAY}::text as to`);
  // Lo que generó: lo cobrado en el mes de las motos que lavó
  const days = await q(
    `select ${localDate('p.created_at')}::text as day, count(*) as washes, sum(p.amount + p.covered) as washed
     from payments p join orders o on o.id = p.order_id
     where o.washer_id = $1 and ${VALID_PAYMENT} and ${localDate('p.created_at')} between $2::date and $3::date
     group by 1 order by 1 desc`,
    [req.user.id, from, to],
  );
  const paid = await q(
    `select day::text, commission, tips, topup, total from payroll_days where user_id = $1 and day between $2::date and $3::date`,
    [req.user.id, from, to],
  );
  // Días pagados sin lavados (base del acuerdo) también se muestran
  const allDays = [...new Set([...days.map((d) => d.day), ...paid.map((p) => p.day)])].sort().reverse();
  const rows = allDays.map((day) => {
    const d = days.find((x) => x.day === day);
    const p = paid.find((x) => x.day === day) ?? null;
    const washed = d ? Number(d.washed) : 0;
    return { day, washes: d ? Number(d.washes) : 0, washed, commission: Math.round((washed * pct) / 100), paid: p };
  });
  const sum = (f: (r: any) => number) => rows.reduce((a, r) => a + f(r), 0);
  const guarantee = await one(
    `select starts_on::text, ends_on::text, base_no_wash, min_commission, max_topup from pay_guarantees
     where user_id = $1 and ${TODAY} between starts_on and ends_on order by created_at desc limit 1`,
    [req.user.id],
  );
  const me = await one(`select ${WASHES()} as washes from users where id = $1`, [req.user.id]);
  res.json({
    from, to, pct, washes: me.washes, guarantee: guarantee ?? null, days: rows,
    totals: {
      washes: sum((r) => r.washes),
      washed: sum((r) => r.washed),
      commission: sum((r) => r.commission),
      topup: sum((r) => r.paid?.topup ?? 0),
      tips: sum((r) => r.paid?.tips ?? 0),
      paid: sum((r) => r.paid?.total ?? 0),
      daysPaid: rows.filter((r) => r.paid).length,
    },
  });
});

// ---- Acuerdos de mínimo ----

nomina.get('/guarantees', auth('OWNER'), async (_req, res) => {
  const rows = await q(
    `select g.id, g.user_id, u.name, g.starts_on::text, g.ends_on::text, g.base_no_wash, g.min_commission, g.max_topup, g.note,
       ${TODAY} between g.starts_on and g.ends_on as current
     from pay_guarantees g join users u on u.id = g.user_id order by g.starts_on desc`,
  );
  // Control de cada acuerdo: los días pagados dentro de sus fechas
  for (const g of rows) {
    g.days = await q(
      `select id, day::text, washes, washed, commission, tips, topup, total from payroll_days
       where user_id = $1 and day between $2::date and $3::date order by day desc`,
      [g.user_id, g.starts_on, g.ends_on],
    );
    g.totals = g.days.reduce(
      (a: any, d: any) => ({ days: a.days + 1, commission: a.commission + d.commission, topup: a.topup + d.topup, total: a.total + d.total }),
      { days: 0, commission: 0, topup: 0, total: 0 },
    );
  }
  res.json(rows);
});

nomina.post('/guarantees', auth('OWNER'), async (req, res) => {
  const b = req.body ?? {};
  const u = await one(`select id, name from users where id = $1 and ${WASHES()}`, [String(b.userId)]);
  need(u, 'Elige la persona.');
  need(DAY.test(String(b.startsOn)) && DAY.test(String(b.endsOn)), 'Elige las fechas del acuerdo.');
  need(b.endsOn >= b.startsOn, 'La fecha final debe ser después de la inicial.');
  const base = int(b.baseNoWash ?? 0, 'La base sin lavados');
  const min = int(b.minCommission ?? 0, 'El mínimo de comisión');
  need(base > 0 || min > 0, 'Pon la base sin lavados o el mínimo de comisión.');
  const cap = b.maxTopup === undefined || b.maxTopup === null || b.maxTopup === '' ? null : int(b.maxTopup, 'El máximo que se completa');
  const g = await one(
    `insert into pay_guarantees (user_id, starts_on, ends_on, base_no_wash, min_commission, max_topup, note, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
    [u.id, b.startsOn, b.endsOn, base, min, cap, optText(b.note, 300), req.user.id],
  );
  await audit(req.user.id, 'ACUERDO_CREADO', 'user', u.id, { persona: u.name, desde: b.startsOn, hasta: b.endsOn, base, minimo: min, tope: cap });
  res.status(201).json({ id: g.id });
});

// Terminar un acuerdo antes de tiempo
nomina.patch('/guarantees/:id', auth('OWNER'), async (req, res) => {
  const g = await one(`select g.*, u.name from pay_guarantees g join users u on u.id = g.user_id where g.id = $1`, [req.params.id]);
  need(g, 'Acuerdo no encontrado.', 404);
  const endsOn = String(req.body?.endsOn);
  need(DAY.test(endsOn), 'Elige la fecha final.');
  need(endsOn >= (await one('select $1::date::text as d', [g.starts_on])).d, 'La fecha final debe ser después de la inicial.');
  await q('update pay_guarantees set ends_on = $2 where id = $1', [g.id, endsOn]);
  await audit(req.user.id, 'ACUERDO_EDITADO', 'user', g.user_id, { persona: g.name, hasta: endsOn });
  res.json({ ok: true });
});
