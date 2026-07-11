-- Suma la fuente DOLARAPI al enum MacroSource (para el dólar blue).
-- Idempotente: ADD VALUE IF NOT EXISTS no falla si ya existe.
-- Postgres 12+ permite ADD VALUE dentro de la transacción de migrate deploy
-- siempre que el nuevo valor no se USE en la misma transacción (no se usa aquí).
ALTER TYPE "MacroSource" ADD VALUE IF NOT EXISTS 'DOLARAPI';
