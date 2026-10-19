-- Cliente de afán: la moto se recibe solo con la placa y los datos del cliente se completan después.
-- Cada moto de afán tiene su propio cliente "Sin registrar" para que el historial siga a la placa.
alter table customers add column pending boolean not null default false;
