-- Página pública (landing): contenido editable en settings('site') y opiniones de clientes.
-- Las opiniones llegan pendientes y solo se muestran cuando el propietario las publica.
create table reviews (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  rating int not null check (rating between 1 and 5),
  comment text not null,
  status text not null default 'PENDIENTE' check (status in ('PENDIENTE', 'PUBLICADA', 'OCULTA')),
  created_at timestamptz not null default now()
);
create index reviews_status on reviews (status, created_at);
alter table reviews enable row level security;

insert into settings (key, value) values
  ('site', '{"whatsapp": "", "instagram": "", "address": "", "mapsUrl": "", "googleReviewsUrl": "", "about": "", "instagramPosts": []}')
on conflict (key) do nothing;
