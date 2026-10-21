-- Edición de cobros: el cobro no se borra, se corrige (medio, descuento, propina, referencia, efectivo).
-- El antes y el después quedan en audit_log (COBRO_EDITADO); aquí solo la última edición.
alter table payments add column edited_at timestamptz;
alter table payments add column edited_by uuid references users(id);
alter table payments add column edit_reason text;
