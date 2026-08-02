-- Ritmo de costeo por ciclos de días fijos (cada 10, cada 15).
--
-- Va SOLA en su propia migración a propósito: en Postgres, un valor nuevo de
-- enum no se puede USAR en la misma transacción en la que se agrega. Separarlo
-- de las columnas que lo referencian evita ese problema de raíz, y hace que
-- este archivo sea trivialmente reversible de leer.
--
-- Migración ADITIVA e IDEMPOTENTE: `IF NOT EXISTS` para que sobreviva dos
-- corridas (`scripts/migrate-deploy.mjs` puede re-correr una migración marcada
-- como rolled-back). No toca ningún valor existente del enum.

-- AlterEnum
ALTER TYPE "Periodicity" ADD VALUE IF NOT EXISTS 'CUSTOM_DAYS';
