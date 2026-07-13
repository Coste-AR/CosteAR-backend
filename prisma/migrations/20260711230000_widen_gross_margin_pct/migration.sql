-- Ensancha grossMarginPct de (9,4) a (18,4). No destructivo: ALTER TYPE que
-- amplía el rango, sin pérdida de datos. Evita el error 22003 (numeric field
-- overflow → HTTP 500) cuando el costo supera muy ampliamente al ingreso y el
-- margen % es de miles de %.
ALTER TABLE "cost_calculations" ALTER COLUMN "grossMarginPct" TYPE DECIMAL(18,4);
