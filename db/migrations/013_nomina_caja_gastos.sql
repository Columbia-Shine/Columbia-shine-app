-- Gastos con categoría (en caja y fuera de caja) y pago de nómina desde la caja.

-- Categoría de los movimientos de caja (gastos) y de los retiros de nómina
alter table cash_movements add column category text;

-- Cómo se pagó la nómina de un día: parte en efectivo de la caja (queda como retiro) y parte por otro medio
alter table payroll_days add column paid_cash int not null default 0;
alter table payroll_days add column paid_other int not null default 0;
alter table payroll_days add column other_method text;
alter table payroll_days add column cash_movement_id uuid references cash_movements(id) on delete set null;
-- Los pagos registrados antes de este cambio quedan como "por fuera" de la caja
update payroll_days set paid_other = total where paid_cash = 0 and paid_other = 0;

-- Gastos pagados por fuera de la caja (arriendo por transferencia, servicios, compras con tarjeta…)
create table expenses (
  id uuid primary key default gen_random_uuid(),
  day date not null,
  category text not null,
  amount int not null check (amount > 0),
  method text not null,
  description text not null,
  created_by uuid not null references users(id),
  created_at timestamptz not null default now()
);
create index expenses_day on expenses (day);
alter table expenses enable row level security;
