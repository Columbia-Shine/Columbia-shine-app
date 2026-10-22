-- Cobro conjunto: un cliente con varias motos paga todo en un solo cobro y un solo comprobante.
-- Cada orden conserva su cobro (para la comisión de su lavador); el grupo guarda lo que es de todo el pago.
create table payment_groups (
  id uuid primary key default gen_random_uuid(),
  method text not null,
  cash_received int,
  reference text,
  created_by uuid not null references users(id),
  created_at timestamptz not null default now()
);
alter table payments add column group_id uuid references payment_groups(id);
create index payments_group on payments (group_id);
alter table payment_groups enable row level security;
