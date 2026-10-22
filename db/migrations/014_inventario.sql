-- Inventario de insumos: compras suman, los conteos ajustan al stock real (la diferencia es lo gastado).
create table supplies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  unit text not null,
  stock numeric(12, 2) not null default 0,
  min_stock numeric(12, 2) not null default 0,
  unit_cost numeric(12, 2) not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table supply_moves (
  id uuid primary key default gen_random_uuid(),
  supply_id uuid not null references supplies(id),
  kind text not null check (kind in ('COMPRA', 'CONTEO')),
  -- Compra: cantidad comprada. Conteo: cambio frente al stock anterior (negativo = lo que se gastó)
  delta numeric(12, 2) not null,
  stock_after numeric(12, 2) not null,
  cost int not null default 0,
  unit_cost numeric(12, 2) not null default 0,
  note text,
  created_by uuid not null references users(id),
  created_at timestamptz not null default now()
);
create index supply_moves_created on supply_moves (created_at);

alter table supplies enable row level security;
alter table supply_moves enable row level security;
