-- Cierre de caja por medio de pago: además del efectivo contado, se confirma lo que entró por
-- cada medio que tuvo cobros en el turno (Nequi, Daviplata, transferencia, datáfono).
-- Formato: [{ "method": "NEQUI", "expected": 50000, "counted": 50000, "difference": 0 }, ...]
alter table shifts add column method_counts jsonb;
