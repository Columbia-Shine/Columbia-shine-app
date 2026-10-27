import { Router } from 'express';
import { audit, Db, localDate, one, pool, q, setting, TODAY, tx } from './db';
import { auth, int, MANAGERS, need, optText, WASHES } from './auth';
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

/** Saldo de cada préstamo vigente (lo prestado menos lo abonado), del más viejo al más nuevo. */
async function loanBalances(db: Db = pool, userId?: string) {
  const rows = await q(
    `select l.id, l.user_id, l.mode, l.day::text, l.amount, l.amount - coalesce((select sum(a.amount) from loan_payments a where a.loan_id = l.id), 0) as balance
     from loans l where l.cancelled_at is null ${userId ? 'and l.user_id = $1' : ''} order by l.day, l.created_at`,
    userId ? [userId] : [],
    db,
  );
  return rows.map((r) => ({ ...r, balance: Number(r.balance) })).filter((r) => r.balance > 0);
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
  const loans = await loanBalances(db);

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
        // Préstamos: lo que se descuenta en este pago (los "del día" de hoy o de antes) y todo lo que debe
        loanDue: loans.filter((l) => l.user_id === u.id && l.mode === 'DIA' && l.day <= day).reduce((a, l) => a + l.balance, 0),
        loanOwed: loans.filter((l) => l.user_id === u.id).reduce((a, l) => a + l.balance, 0),
      };
    })
    .filter((p) => p.washes > 0 || p.guarantee || p.paid || p.loanDue > 0);
  return { day, pct, people };
}

nomina.get('/payroll', auth('OWNER'), async (req, res) => {
  const day = DAY.test(String(req.query.day)) ? String(req.query.day) : await today();
  res.json({ ...(await dayFigures(day)), shiftOpen: !!(await openShift()) });
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
    // Préstamos: por defecto se descuenta lo prestado "para el día"; el dueño puede descontar más (abono) o menos
    const deduct = b.loanDeduct === undefined || b.loanDeduct === null ? Math.min(fig.loanDue, total) : int(b.loanDeduct, 'Lo descontado de préstamos');
    need(deduct <= fig.loanOwed, 'No puedes descontar más de lo que debe en préstamos.');
    need(deduct <= total, 'No puedes descontar más de lo que gana ese día.');
    const net = total - deduct;
    // Cómo se le pagó: efectivo de la caja (queda como retiro) y/o por Nequi u otro medio
    const cash = b.cash === undefined || b.cash === null ? 0 : int(b.cash, 'El efectivo');
    const other = net - cash;
    need(cash <= net, 'El efectivo no puede ser más que lo que se le entrega.');
    const otherMethod = other > 0 ? String(b.otherMethod ?? '') : null;
    need(!other || OUT_METHODS.includes(otherMethod!), 'Elige por qué medio pagaste el resto.');
    let movementId: string | null = null;
    // Con turno abierto el efectivo sale de la caja (retiro); sin turno, se pagó por fuera de la caja
    const shift = cash > 0 ? await openShift(c) : null;
    if (shift) {
      movementId = (
        await one(
          `insert into cash_movements (shift_id, kind, amount, description, category, created_by) values ($1, 'RETIRO', $2, $3, 'Nómina', $4) returning id`,
          [shift.id, cash, `Nómina ${fig.name} ${day}`, req.user.id],
          c,
        )
      ).id;
    }
    const row = await one(
      `insert into payroll_days (user_id, day, washes, washed, commission, tips, topup, total, guarantee_id, note, paid_by, paid_cash, paid_other, other_method, cash_movement_id, loans)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) returning id`,
      [fig.id, day, fig.washes, fig.washed, fig.commission, fig.tips, topup, total, fig.guarantee?.id ?? null, optText(b.note, 300), req.user.id, cash, other, otherMethod, movementId, deduct],
      c,
    );
    // El descuento abona primero a los préstamos "del día" y luego a los demás, del más viejo al más nuevo
    let left = deduct;
    const dueFirst = (l: { mode: string; day: string }) => Number(l.mode === 'DIA' && l.day <= day);
    const loans = (await loanBalances(c, fig.id)).sort((x, y) => dueFirst(y) - dueFirst(x));
    for (const l of loans) {
      if (left <= 0) break;
      const part = Math.min(left, l.balance);
      await c.query(`insert into loan_payments (loan_id, amount, method, payroll_day_id, created_by) values ($1, $2, 'NOMINA', $3, $4)`, [l.id, part, row.id, req.user.id]);
      left -= part;
    }
    await audit(
      req.user.id, 'NOMINA_PAGADA', 'user', fig.id,
      { persona: fig.name, dia: day, comision: fig.commission, propinas: fig.tips, ajuste: topup, total, prestamo_descontado: deduct || null, efectivo: cash, otro_medio: other ? `${otherMethod} ${other}` : null },
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
  const loanBalance = (await loanBalances(pool, req.user.id)).reduce((a, l) => a + l.balance, 0);
  res.json({
    from, to, pct, washes: me.washes, guarantee: guarantee ?? null, days: rows, loanBalance,
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

// ---- Préstamos al equipo ----

const LOAN_MODES = ['DIA', 'DESPUES'];

/** A quién se le puede prestar: quienes lavan (se les descuenta en la nómina). */
nomina.get('/loans/people', auth(...MANAGERS), async (_req, res) => {
  res.json(await q(`select id, name from users where active and ${WASHES()} order by name`));
});

nomina.get('/loans', auth('OWNER'), async (_req, res) => {
  const rows = await q(
    `select l.id, l.user_id, u.name, l.amount, l.mode, l.day::text, l.source, l.note, l.created_at, l.cancelled_at, c.name as created_by_name,
       l.amount - coalesce((select sum(a.amount) from loan_payments a where a.loan_id = l.id), 0) as balance,
       coalesce((select json_agg(json_build_object('amount', a.amount, 'method', a.method, 'created_at', a.created_at) order by a.created_at)
                 from loan_payments a where a.loan_id = l.id), '[]') as payments
     from loans l join users u on u.id = l.user_id join users c on c.id = l.created_by
     order by l.created_at desc limit 200`,
  );
  for (const r of rows) r.balance = Number(r.balance);
  const open = rows.filter((r) => !r.cancelled_at && r.balance > 0);
  // Lo que debe cada persona en total
  const owed = Object.values(
    open.reduce((a: Record<string, any>, r) => {
      a[r.user_id] = { id: r.user_id, name: r.name, balance: (a[r.user_id]?.balance ?? 0) + r.balance };
      return a;
    }, {}),
  );
  res.json({ open, owed, closed: rows.filter((r) => r.cancelled_at || r.balance <= 0).slice(0, 15), shiftOpen: !!(await openShift()) });
});

nomina.post('/loans', auth(...MANAGERS), async (req, res) => {
  const b = req.body ?? {};
  const u = await one(`select id, name from users where id = $1 and active and ${WASHES()}`, [String(b.userId)]);
  need(u, 'Elige a quién le prestas.');
  const amount = int(b.amount, 'El valor del préstamo', 1);
  const mode = String(b.mode);
  need(LOAN_MODES.includes(mode), 'Elige si se descuenta del pago de hoy o lo paga después.');
  // El administrador solo presta de la caja; el dueño también puede prestar por fuera (Nequi, su bolsillo)
  const source = req.user.role === 'OWNER' ? String(b.source ?? 'CAJA') : 'CAJA';
  need(['CAJA', 'FUERA'].includes(source), 'Elige de dónde sale la plata.');
  const note = optText(b.note, 200);
  const id = await tx(async (c) => {
    let movementId: string | null = null;
    if (source === 'CAJA') {
      const shift = await openShift(c);
      need(shift, 'No hay turno de caja abierto. Abre la caja o regístralo como préstamo por fuera.');
      movementId = (
        await one(
          `insert into cash_movements (shift_id, kind, amount, description, category, created_by) values ($1, 'RETIRO', $2, $3, 'Préstamo', $4) returning id`,
          [shift.id, amount, `Préstamo a ${u.name}${note ? ' · ' + note : ''}`, req.user.id],
          c,
        )
      ).id;
    }
    const l = await one(
      `insert into loans (user_id, amount, mode, day, source, cash_movement_id, note, created_by) values ($1, $2, $3, ${TODAY}, $4, $5, $6, $7) returning id`,
      [u.id, amount, mode, source, movementId, note, req.user.id],
      c,
    );
    await audit(
      req.user.id, 'PRESTAMO_REGISTRADO', 'user', u.id,
      { persona: u.name, valor: amount, se_paga: mode === 'DIA' ? 'descontado del pago del día' : 'después', sale_de: source === 'CAJA' ? 'la caja' : 'por fuera de la caja', nota: note },
      c,
    );
    return l.id;
  });
  res.status(201).json({ id });
});

// Abono en efectivo: con turno abierto entra a la caja; sin turno (solo el dueño) queda recibido por fuera
nomina.post('/loans/:id/payments', auth(...MANAGERS), async (req, res) => {
  const amount = int(req.body?.amount, 'El abono', 1);
  await tx(async (c) => {
    await c.query('select pg_advisory_xact_lock(hashtext($1))', [`loan:${req.params.id}`]);
    const l = await one(
      `select l.*, u.name, l.amount - coalesce((select sum(a.amount) from loan_payments a where a.loan_id = l.id), 0) as balance
       from loans l join users u on u.id = l.user_id where l.id = $1`,
      [String(req.params.id)],
      c,
    );
    need(l && !l.cancelled_at, 'Préstamo no encontrado.', 404);
    need(amount <= Number(l.balance), 'El abono no puede ser más de lo que debe.');
    const shift = await openShift(c);
    need(shift || req.user.role === 'OWNER', 'No hay turno de caja abierto.');
    const movementId = shift
      ? (
          await one(
            `insert into cash_movements (shift_id, kind, amount, description, category, created_by) values ($1, 'ENTRADA', $2, $3, 'Préstamo', $4) returning id`,
            [shift.id, amount, `Abono préstamo de ${l.name}`, req.user.id],
            c,
          )
        ).id
      : null;
    await c.query(`insert into loan_payments (loan_id, amount, method, cash_movement_id, created_by) values ($1, $2, 'EFECTIVO', $3, $4)`, [l.id, amount, movementId, req.user.id]);
    await audit(req.user.id, 'PRESTAMO_ABONO', 'user', l.user_id, { persona: l.name, abono: amount, queda_debiendo: Number(l.balance) - amount, entra_a: shift ? 'la caja' : 'por fuera de la caja' }, c);
  });
  res.status(201).json({ ok: true });
});

// Anular un préstamo mal registrado (solo si no tiene abonos)
nomina.delete('/loans/:id', auth('OWNER'), async (req, res) => {
  const l = await one(`select l.*, u.name from loans l join users u on u.id = l.user_id where l.id = $1`, [String(req.params.id)]);
  need(l && !l.cancelled_at, 'Préstamo no encontrado.', 404);
  need(!(await one('select 1 from loan_payments where loan_id = $1 limit 1', [l.id])), 'Ese préstamo ya tiene abonos: no se puede anular.');
  const mov = l.cash_movement_id
    ? await one('select m.id, s.closed_at from cash_movements m join shifts s on s.id = m.shift_id where m.id = $1', [l.cash_movement_id])
    : null;
  await tx(async (c) => {
    await c.query('update loans set cancelled_at = now(), cancelled_by = $2 where id = $1', [l.id, req.user.id]);
    // El retiro de caja se deshace solo si su turno sigue abierto; si ya cerró, queda en ese cierre
    if (mov && !mov.closed_at) await c.query('delete from cash_movements where id = $1', [mov.id]);
    await audit(req.user.id, 'PRESTAMO_ANULADO', 'user', l.user_id, { persona: l.name, valor: l.amount, retiro_deshecho: !!(mov && !mov.closed_at) }, c);
  });
  res.json({ ok: true, cashKept: !!(mov && mov.closed_at) });
});
