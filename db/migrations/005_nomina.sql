-- Nómina diaria del equipo y acuerdos de mínimo (por ejemplo, el primer mes de un lavador).

-- Acuerdo de mínimo por persona y por fechas:
-- sin lavados en el día se paga base_no_wash (si vino); con lavados, si la comisión no llega a
-- min_commission se completa hasta ese valor. Las propinas van aparte.
create table pay_guarantees (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  starts_on date not null,
  ends_on date not null,
  base_no_wash int not null default 0,
  min_commission int not null default 0,
  note text,
  created_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  check (ends_on >= starts_on)
);
create index pay_guarantees_user on pay_guarantees (user_id, starts_on);

-- Pago registrado de un día a una persona: se guarda la foto de las cifras con que se pagó.
create table payroll_days (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  day date not null,
  washes int not null default 0,
  washed int not null default 0,
  commission int not null default 0,
  tips int not null default 0,
  topup int not null default 0,
  total int not null,
  guarantee_id uuid references pay_guarantees(id),
  note text,
  paid_by uuid not null references users(id),
  paid_at timestamptz not null default now(),
  unique (user_id, day)
);

alter table pay_guarantees enable row level security;
alter table payroll_days enable row level security;
