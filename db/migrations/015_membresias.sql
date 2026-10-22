-- Membresías: se vende un plan para una moto (placa), dura 30 días y trae N lavados de un servicio.
-- Lo no usado vence. Al usarla, el servicio sale en $0 y el lavador gana su comisión sobre el precio normal.

create table membership_plans (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  service_id uuid not null references services(id),
  washes int not null check (washes > 0),
  price int not null check (price > 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table memberships (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references membership_plans(id),
  bike_id uuid not null references bikes(id),
  customer_id uuid not null references customers(id),
  -- Copia del plan al venderla (si después cambia el plan, esta no cambia)
  name text not null,
  service_id uuid not null references services(id),
  washes int not null,
  price int not null,
  starts_on date not null,
  ends_on date not null,
  cancelled_at timestamptz,
  created_by uuid not null references users(id),
  created_at timestamptz not null default now()
);
create index memberships_bike on memberships (bike_id, ends_on);

-- La venta de una membresía es un cobro sin orden; usar un lavado de membresía es un cobro de la orden
-- con "covered" = valor del servicio que cubrió la membresía (cuenta para la comisión, no para las ventas)
alter table payments alter column order_id drop not null;
alter table payments add column membership_id uuid references memberships(id);
alter table payments add column covered int not null default 0;
alter table payments add constraint payments_order_or_membership check (order_id is not null or membership_id is not null);
alter table payments drop constraint payments_method_check;
alter table payments add constraint payments_method_check
  check (method in ('EFECTIVO', 'NEQUI', 'DAVIPLATA', 'TRANSFERENCIA', 'DATAFONO', 'MEMBRESIA'));

alter table orders add column membership_id uuid references memberships(id);

alter table membership_plans enable row level security;
alter table memberships enable row level security;
