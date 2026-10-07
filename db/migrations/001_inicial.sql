-- Columbia Shine: esquema inicial del MVP
create extension if not exists pgcrypto;

create table customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  document text,
  phone text unique,
  email text,
  created_at timestamptz not null default now()
);

create table users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  role text not null check (role in ('OWNER', 'ADMIN', 'WASHER', 'CLIENT')),
  email text unique,
  phone text unique,
  password_hash text,
  pin_hash text,
  customer_id uuid references customers(id),
  active boolean not null default true,
  failed_attempts int not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now()
);

create table bikes (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id),
  plate text not null unique,
  brand text,
  model text,
  year int,
  color text,
  notes text,
  created_at timestamptz not null default now()
);

create table services (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  kind text not null check (kind in ('BASE', 'EXTRA')),
  price int not null,
  price_from boolean not null default false,
  min_minutes int,
  max_minutes int,
  direct_cost int,
  focus text,
  steps jsonb not null default '[]',
  recommended boolean not null default false,
  active boolean not null default true,
  sort int not null default 0
);

create table shifts (
  id uuid primary key default gen_random_uuid(),
  opened_by uuid not null references users(id),
  opened_at timestamptz not null default now(),
  opening_cash int not null default 0,
  closed_by uuid references users(id),
  closed_at timestamptz,
  expected_cash int,
  counted_cash int,
  difference int,
  difference_note text
);
create unique index one_open_shift on shifts ((true)) where closed_at is null;

create table bookings (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id),
  bike_id uuid references bikes(id),
  service_id uuid not null references services(id),
  starts_at timestamptz not null,
  status text not null default 'BOOKED' check (status in ('BOOKED', 'ARRIVED', 'CANCELLED')),
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);
create index bookings_starts on bookings (starts_at);

create sequence order_number_seq;

create table orders (
  id uuid primary key default gen_random_uuid(),
  number bigint not null unique default nextval('order_number_seq'),
  customer_id uuid not null references customers(id),
  bike_id uuid not null references bikes(id),
  service_id uuid not null references services(id),
  booking_id uuid references bookings(id),
  status text not null default 'WAITING'
    check (status in ('WAITING', 'WASHING', 'REVIEW', 'READY', 'DELIVERED', 'CANCELLED')),
  washer_id uuid references users(id),
  notes text,
  total int not null,
  created_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  ready_at timestamptz,
  delivered_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text
);
create index orders_status on orders (status);
create index orders_created on orders (created_at);

create table order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  service_id uuid not null references services(id),
  name text not null,
  kind text not null,
  price int not null
);

create table order_photos (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  mime text not null,
  data bytea not null,
  created_at timestamptz not null default now()
);

create table payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id),
  shift_id uuid not null references shifts(id),
  method text not null check (method in ('EFECTIVO', 'NEQUI', 'DAVIPLATA', 'TRANSFERENCIA', 'DATAFONO')),
  amount int not null,
  tip int not null default 0,
  cash_received int,
  reference text,
  created_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  void_status text check (void_status in ('REQUESTED', 'APPROVED', 'REJECTED')),
  void_reason text,
  void_requested_by uuid references users(id),
  void_requested_at timestamptz,
  void_resolved_by uuid references users(id),
  void_resolved_at timestamptz
);
create index payments_shift on payments (shift_id);

create table cash_movements (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references shifts(id),
  kind text not null check (kind in ('GASTO', 'RETIRO', 'ENTRADA')),
  amount int not null check (amount > 0),
  description text not null,
  created_by uuid not null references users(id),
  created_at timestamptz not null default now()
);

create table audit_log (
  id bigserial primary key,
  user_id uuid references users(id),
  action text not null,
  entity text,
  entity_id text,
  detail jsonb,
  created_at timestamptz not null default now()
);

create table settings (
  key text primary key,
  value jsonb not null
);

insert into settings (key, value) values
  ('commission_pct', '45'),
  ('slot_capacity', '2');

-- Servicios y adicionales del manual interno
insert into services (code, name, kind, price, price_from, min_minutes, max_minutes, direct_cost, focus, recommended, sort, steps) values
  ('BASIC', 'Shine Basic', 'BASE', 16000, false, 20, 25, 5600, 'Lavado esencial', false, 1,
    '["Enjuague", "Lavado con shampoo pH neutro", "Enjuague", "Secado"]'),
  ('PREMIUM', 'Shine Premium', 'BASE', 25000, false, 30, 40, 8900, 'Lavado + cuidado', false, 2,
    '["Prelavado", "Lavado pH neutro", "Desengrase puntual", "Limpieza detallada", "Plásticos y llantas", "Secado"]'),
  ('DETAIL', 'Shine Detail', 'BASE', 35000, false, 60, 75, 17100, 'Limpieza + detallado', true, 3,
    '["Prelavado y lavado", "Desengrase controlado", "Limpieza profunda", "Tratamiento de superficies", "Llantas", "Cera", "Secado y revisión"]'),
  ('FULL', 'Shine Full', 'BASE', 50000, false, 120, 150, 30200, 'Detallado completo', false, 4,
    '["Prelavado y lavado", "Desengrase", "Detallado profundo y motor", "Manchas y óxido si aplica", "Plásticos y llantas", "Cera e inspección final"]'),
  ('X_MOTOR', 'Detallado de motor', 'EXTRA', 15000, false, null, null, null, 'Evitar conectores y zonas eléctricas', false, 10, '[]'),
  ('X_CADENA', 'Desengrase y lubricación de cadena', 'EXTRA', 12000, false, null, null, null, 'Cadena fría antes de trabajar', false, 11, '[]'),
  ('X_CERA', 'Cera porcelanizadora', 'EXTRA', 10000, false, null, null, null, 'No vender como coating cerámico', false, 12, '[]'),
  ('X_LLANTAS', 'Restauración de llantas', 'EXTRA', 7000, false, null, null, null, 'No aplicar en banda de rodamiento', false, 13, '[]'),
  ('X_PLASTICOS', 'Hidratación de plásticos', 'EXTRA', 8000, false, null, null, null, 'Solo superficies adecuadas', false, 14, '[]'),
  ('X_OXIDO', 'Eliminación de óxido', 'EXTRA', 10000, true, null, null, null, 'Depende del nivel; no prometer eliminación total', false, 15, '[]'),
  ('X_MANCHAS', 'Desmanchado', 'EXTRA', 10000, true, null, null, null, 'Probar primero en zona discreta', false, 16, '[]');

-- Supabase expone el esquema public por su API: con RLS activo y sin políticas,
-- solo el backend (que se conecta como dueño de las tablas) puede leer y escribir.
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;
