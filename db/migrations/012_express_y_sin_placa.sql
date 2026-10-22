-- Servicio Shine Express: solo quitar el barro, con agua y trapo para secar.
insert into services (code, name, kind, price, price_from, min_minutes, max_minutes, direct_cost, focus, recommended, sort, steps) values
  ('EXPRESS', 'Shine Express', 'BASE', 10000, false, 10, 15, 1000, 'Quitar el barro: agua y secado', false, 0,
    '["Enjuague con agua para quitar el barro", "Secado con trapo"]')
on conflict (code) do nothing;

-- Motos sin placa: se les asigna un código interno SP0001, SP0002…
create sequence no_plate_seq;
alter table bikes add column no_plate boolean not null default false;
