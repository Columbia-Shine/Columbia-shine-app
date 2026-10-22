-- Clientes para recuperar: cuándo se le escribió por última vez para invitarlo a volver.
alter table customers add column last_contacted_at timestamptz;
