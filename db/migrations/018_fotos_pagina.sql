-- Fotos de la página pública que sube el propietario: antes y después, equipo y foto de portada.
-- Se reducen en el navegador (JPEG de máximo 1600 px) y se guardan aquí, como las fotos de recepción.
create table site_images (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('ANTES_DESPUES', 'EQUIPO', 'PORTADA')),
  title text,
  caption text,
  mime text not null default 'image/jpeg',
  data bytea not null,
  -- Solo para ANTES_DESPUES: la foto del antes (data es la del después)
  before_data bytea,
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create index site_images_kind on site_images (kind, sort);
alter table site_images enable row level security;
