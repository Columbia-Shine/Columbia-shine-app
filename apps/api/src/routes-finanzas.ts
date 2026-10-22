import { Router } from 'express';
import { audit, localDate, one, q, setting, TODAY } from './db';
import { auth, EXPENSE_CATEGORIES, int, need, text } from './auth';

/** Gastos por fuera de la caja y cierre del mes. Solo el propietario. */
export const finanzas = Router();

const VALID_PAYMENT = `p.void_status is distinct from 'APPROVED'`;
const MONTH = /^\d{4}-\d{2}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const EXPENSE_METHODS = ['TRANSFERENCIA', 'NEQUI', 'DAVIPLATA', 'TARJETA', 'EFECTIVO'];

async function currentMonth(): Promise<string> {
  return (await one(`select to_char(${TODAY}, 'YYYY-MM') as m`)).m;
}

/** Primer y último día de un mes 'YYYY-MM'. */
async function range(month: string): Promise<{ from: string; to: string }> {
  return (await one(`select $1::date::text as from, ($1::date + interval '1 month' - interval '1 day')::date::text as to`, [month + '-01']))!;
}

// ---- Gastos por fuera de la caja ----

finanzas.get('/expenses', auth('OWNER'), async (req, res) => {
  const month = MONTH.test(String(req.query.month)) ? String(req.query.month) : await currentMonth();
  const { from, to } = await range(month);
  res.json(
    await q(
      `select e.id, e.day::text, e.category, e.amount, e.method, e.description, u.name as created_by_name
       from expenses e join users u on u.id = e.created_by where e.day between $1::date and $2::date order by e.day desc, e.created_at desc`,
      [from, to],
    ),
  );
});

finanzas.post('/expenses', auth('OWNER'), async (req, res) => {
  const b = req.body ?? {};
  const day = String(b.day);
  need(DAY.test(day), 'Elige el día del gasto.');
  need(EXPENSE_CATEGORIES.includes(String(b.category)), 'Elige la categoría del gasto.');
  need(EXPENSE_METHODS.includes(String(b.method)), 'Elige cómo lo pagaste.');
  const amount = int(b.amount, 'El valor', 1);
  const description = text(b.description, 'la descripción', 200);
  const e = await one(
    `insert into expenses (day, category, amount, method, description, created_by) values ($1, $2, $3, $4, $5, $6) returning id`,
    [day, b.category, amount, b.method, description, req.user.id],
  );
  await audit(req.user.id, 'GASTO_REGISTRADO', 'expense', e.id, { dia: day, categoria: b.category, valor: amount, medio: b.method, descripcion: description });
  res.status(201).json({ id: e.id });
});

finanzas.delete('/expenses/:id', auth('OWNER'), async (req, res) => {
  const e = await one('delete from expenses where id = $1 returning *', [req.params.id]);
  need(e, 'Gasto no encontrado.', 404);
  await audit(req.user.id, 'GASTO_BORRADO', 'expense', e.id, { dia: e.day, categoria: e.category, valor: e.amount, descripcion: e.description });
  res.json({ ok: true });
});

// ---- Cierre del mes ----

async function monthFigures(month: string) {
  const { from, to } = await range(month);
  const P = [from, to];
  const inMonth = `${localDate('p.created_at')} between $1::date and $2::date and ${VALID_PAYMENT}`;
  const t = await one(
    `select coalesce(sum(p.amount), 0) as sales, coalesce(sum(p.tip), 0) as tips, coalesce(sum(p.discount), 0) as discounts,
       count(*) filter (where p.order_id is not null) as bikes
     from payments p where ${inMonth}`,
    P,
  );
  const sales = Number(t.sales);
  const bikes = Number(t.bikes);
  // Gastos: los de la caja (con categoría) más los pagados por fuera
  const expenses = await q(
    `select category, sum(amount) as amount from (
       select coalesce(m.category, 'Otro') as category, m.amount from cash_movements m
       where m.kind = 'GASTO' and ${localDate('m.created_at')} between $1::date and $2::date
       union all
       select e.category, e.amount from expenses e where e.day between $1::date and $2::date
     ) x group by category order by sum(amount) desc`,
    P,
  );
  const expensesTotal = expenses.reduce((a, e) => a + Number(e.amount), 0);
  // Nómina: comisión de lo cobrado de cada lavador + ajustes de acuerdos pagados (las propinas son de ellos, no del negocio)
  const pct = await setting('commission_pct', 45);
  const byWasher = await q(
    `select w.name, count(*) as n, sum(p.amount) as washed from payments p join orders o on o.id = p.order_id join users w on w.id = o.washer_id
     where ${inMonth} group by w.name order by sum(p.amount) desc`,
    P,
  );
  const commission = byWasher.reduce((a, w) => a + Math.round((Number(w.washed) * pct) / 100), 0);
  const topups = Number((await one(`select coalesce(sum(topup), 0) as t from payroll_days where day between $1::date and $2::date`, P)).t);
  const byService = await q(
    `select i.name, count(*) as n, sum(i.price) as amount from payments p join order_items i on i.order_id = p.order_id
     where ${inMonth} and i.kind = 'BASE' group by i.name order by sum(i.price) desc`,
    P,
  );
  const payroll = commission + topups;
  return {
    month, from, to, sales, bikes, tips: Number(t.tips), discounts: Number(t.discounts),
    ticket: bikes ? Math.round(sales / bikes) : 0,
    expenses: expenses.map((e) => ({ category: e.category, amount: Number(e.amount) })),
    expensesTotal, commission, topups, payroll,
    profit: sales - expensesTotal - payroll,
    byWasher: byWasher.map((w) => ({ name: w.name, n: Number(w.n), washed: Number(w.washed), commission: Math.round((Number(w.washed) * pct) / 100) })),
    byService: byService.map((s) => ({ name: s.name, n: Number(s.n), amount: Number(s.amount) })),
  };
}

finanzas.get('/month-close', auth('OWNER'), async (req, res) => {
  const month = MONTH.test(String(req.query.month)) ? String(req.query.month) : await currentMonth();
  const prev = (await one(`select to_char($1::date - interval '1 month', 'YYYY-MM') as m`, [month + '-01'])).m;
  res.json({ current: await monthFigures(month), previous: await monthFigures(prev), today: (await one(`select ${TODAY}::text as d`)).d });
});
