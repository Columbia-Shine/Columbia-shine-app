-- Quién lava: todos los lavadores (WASHER) y solo los administradores marcados con washes = true
-- (Gregorio administra y lava; el usuario del celular de la empresa solo administra).
alter table users add column washes boolean not null default false;
update users set washes = true where role = 'WASHER';
