import { Router } from 'express';
import { audit, localDate, one, q, TODAY, tx } from './db';
import { auth, MANAGERS, need, optText, text } from './auth';
import { openShift } from './routes-ordenes';

/** Inventario de insumos: compras, conteos, alertas de stock bajo y consumo del mes. */
export const inventario = Router();

const VALID_PAYMENT = `p.void_status is distinct from 'APPROVED'`;
const MONTH = /^\d{4}-\d{2}$/;
const UNITS = ['ml', 'L', 'g', 'kg', 'unidades'];
// Cómo se pagó una compra: con efectivo de la caja (gasto de caja) o por fuera (gasto del mes)
const PURCHASE_METHODS = ['CAJA', 'TRANSFERENCIA', 'NEQUI', 'DAVIPLATA', 'TARJETA', 'EFECTIVO'];

const qty = (v: unknown, label: string, allowZero = false): number => {
  const n = Number(v);
  need(Number.isFinite(n) && (allowZero ? n >= 0 : n > 0), `${label} no es un valor válido.`);
  return Math.round(n * 100) / 100;
};

inventario.get('/supplies', auth(...MANAGERS), async (req, res) => {
  const rows = await q(
    `select id, name, unit, stock::float as stock, min_stock::float as min_stock, unit_cost::float as unit_cost, active,
       stock <= min_stock as low,
       (select max(m.created_at) from supply_moves m where m.supply_id = s.id and m.kind = 'CONTEO') as last_count
     from supplies s ${req.user.role === 'OWNER' ? '' : 'where active'} order by active desc, name`,
  );
  // Los costos solo los ve el propietario
  res.json(req.user.role === 'OWNER' ? rows : rows.map(({ unit_cost, ...r }) => r));
});

inventario.post('/supplies', auth('OWNER'), async (req, res) => {
  const b = req.body ?? {};
  const name = text(b.name, 'el nombre del insumo', 80);
  need(UNITS.includes(String(b.unit)), 'Elige la unidad.');
  const s = await one(`insert into supplies (name, unit, min_stock) values ($1, $2, $3) returning id`, [name, b.unit, qty(b.minStock ?? 0, 'El mínimo', true)]);
  await audit(req.user.id, 'INSUMO_CREADO', 'supply', s.id, { insumo: name, unidad: b.unit });
  res.status(201).json({ id: s.id });
});

inventario.patch('/supplies/:id', auth('OWNER'), async (req, res) => {
  const s = await one('select * from supplies where id = $1', [req.params.id]);
  need(s, 'Insumo no encontrado.', 404);
  const b = req.body ?? {};
  const min = b.minStock === undefined ? s.min_stock : qty(b.minStock, 'El mínimo', true);
  const active = b.active === undefined ? s.active : !!b.active;
  await q('update supplies set min_stock = $2, active = $3 where id = $1', [s.id, min, active]);
  await audit(req.user.id, 'INSUMO_EDITADO', 'supply', s.id, { insumo: s.name, minimo: min, activo: active });
  res.json({ ok: true });
});

// Compra: suma al stock, actualiza el costo por unidad y registra el gasto
inventario.post('/supplies/:id/purchase', auth(...MANAGERS), async (req, res) => {
  const b = req.body ?? {};
  const amount = qty(b.qty, 'La cantidad');
  const cost = Math.round(qty(b.cost, 'El valor pagado'));
  const method = String(b.method);
  need(PURCHASE_METHODS.includes(method), 'Elige cómo se pagó.');
  await tx(async (c) => {
    const s = await one('select * from supplies where id = $1 for update', [req.params.id], c);
    need(s && s.active, 'Insumo no encontrado.', 404);
    const stock = Number(s.stock) + amount;
    const unitCost = Math.round((cost / amount) * 100) / 100;
    await c.query('update supplies set stock = $2, unit_cost = $3 where id = $1', [s.id, stock, unitCost]);
    await c.query(
      `insert into supply_moves (supply_id, kind, delta, stock_after, cost, unit_cost, note, created_by) values ($1, 'COMPRA', $2, $3, $4, $5, $6, $7)`,
      [s.id, amount, stock, cost, unitCost, optText(b.note, 200), req.user.id],
    );
    const description = `Compra de ${s.name} (${amount} ${s.unit})`;
    if (method === 'CAJA') {
      const shift = await openShift(c);
      need(shift, 'Para pagar con efectivo de la caja, abre el turno de caja.');
      await c.query(`insert into cash_movements (shift_id, kind, amount, description, category, created_by) values ($1, 'GASTO', $2, $3, 'Insumos', $4)`, [
        shift.id, cost, description, req.user.id,
      ]);
    } else {
      await c.query(`insert into expenses (day, category, amount, method, description, created_by) values (${TODAY}, 'Insumos', $1, $2, $3, $4)`, [
        cost, method, description, req.user.id,
      ]);
    }
    await audit(req.user.id, 'INSUMO_COMPRA', 'supply', s.id, { insumo: s.name, cantidad: amount, valor: cost, medio: method }, c);
  });
  res.status(201).json({ ok: true });
});

// Conteo: se ajusta al stock real; la diferencia es lo que se gastó desde el último conteo
inventario.post('/supplies/:id/count', auth(...MANAGERS), async (req, res) => {
  const counted = qty(req.body?.qty, 'La cantidad contada', true);
  await tx(async (c) => {
    const s = await one('select * from supplies where id = $1 for update', [req.params.id], c);
    need(s && s.active, 'Insumo no encontrado.', 404);
    const delta = Math.round((counted - Number(s.stock)) * 100) / 100;
    await c.query('update supplies set stock = $2 where id = $1', [s.id, counted]);
    await c.query(
      `insert into supply_moves (supply_id, kind, delta, stock_after, unit_cost, note, created_by) values ($1, 'CONTEO', $2, $3, $4, $5, $6)`,
      [s.id, delta, counted, s.unit_cost, optText(req.body?.note, 200), req.user.id],
    );
    await audit(req.user.id, 'INSUMO_CONTEO', 'supply', s.id, { insumo: s.name, antes: Number(s.stock), contado: counted, diferencia: delta }, c);
  });
  res.status(201).json({ ok: true });
});

// Consumo del mes: lo gastado según los conteos, valorizado, y el costo real por moto
inventario.get('/supplies/usage', auth('OWNER'), async (req, res) => {
  const month = MONTH.test(String(req.query.month)) ? String(req.query.month) : (await one(`select to_char(${TODAY}, 'YYYY-MM') as m`)).m;
  const { from, to } = (await one(`select $1::date::text as from, ($1::date + interval '1 month' - interval '1 day')::date::text as to`, [month + '-01']))!;
  const rows = await q(
    `select s.name, s.unit, coalesce(sum(-m.delta) filter (where m.delta < 0), 0)::float as used,
       coalesce(sum(-m.delta * m.unit_cost) filter (where m.delta < 0), 0)::float as cost,
       coalesce(sum(m.delta) filter (where m.kind = 'COMPRA'), 0)::float as bought
     from supplies s join supply_moves m on m.supply_id = s.id
     where ${localDate('m.created_at')} between $1::date and $2::date
     group by s.name, s.unit order by 4 desc`,
    [from, to],
  );
  const bikes = Number(
    (await one(`select count(*) as n from payments p where p.order_id is not null and ${VALID_PAYMENT} and ${localDate('p.created_at')} between $1::date and $2::date`, [from, to])).n,
  );
  const total = Math.round(rows.reduce((a, r) => a + r.cost, 0));
  res.json({ month, rows: rows.map((r) => ({ ...r, cost: Math.round(r.cost) })), total, bikes, perBike: bikes ? Math.round(total / bikes) : 0 });
});
