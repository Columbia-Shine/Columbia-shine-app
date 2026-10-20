-- Tope del ajuste en los acuerdos de mínimo: con lavados se completa hasta min_commission,
-- pero nunca más de max_topup. Vacío = sin tope.
alter table pay_guarantees add column max_topup int;
