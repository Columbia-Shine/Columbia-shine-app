-- Préstamos al equipo: de la caja o por fuera, para descontar del pago del día o pagar después.

create table loans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  amount int not null check (amount > 0),
  -- DIA: se descuenta en el pago de nómina de ese día · DESPUES: queda debiendo y abona cuando pueda
  mode text not null check (mode in ('DIA', 'DESPUES')),
  day date not null,
  -- CAJA: salió del efectivo del turno (queda como retiro) · FUERA: el dueño lo dio por fuera de la caja
  source text not null check (source in ('CAJA', 'FUERA')),
  cash_movement_id uuid references cash_movements(id) on delete set null,
  note text,
  created_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancelled_by uuid references users(id)
);
create index loans_user on loans (user_id) where cancelled_at is null;

-- Abonos a un préstamo: descontados de un pago de nómina o devueltos en efectivo
create table loan_payments (
  id uuid primary key default gen_random_uuid(),
  loan_id uuid not null references loans(id),
  amount int not null check (amount > 0),
  method text not null check (method in ('NOMINA', 'EFECTIVO')),
  payroll_day_id uuid references payroll_days(id) on delete cascade,
  cash_movement_id uuid references cash_movements(id) on delete set null,
  created_by uuid not null references users(id),
  created_at timestamptz not null default now()
);
create index loan_payments_loan on loan_payments (loan_id);

-- Lo descontado de préstamos en un pago de nómina: se le entregó total − loans
alter table payroll_days add column loans int not null default 0;

alter table loans enable row level security;
alter table loan_payments enable row level security;
