-- Descuento al cobrar: payments.amount queda con el valor ya descontado (lo que de verdad entra),
-- y aquí se guarda cuánto se descontó y por qué.
alter table payments add column discount int not null default 0;
alter table payments add column discount_reason text;
