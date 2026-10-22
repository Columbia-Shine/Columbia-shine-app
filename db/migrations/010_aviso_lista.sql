-- Aviso "tu moto está lista" por WhatsApp: cuándo se le avisó al cliente.
alter table orders add column notified_at timestamptz;
