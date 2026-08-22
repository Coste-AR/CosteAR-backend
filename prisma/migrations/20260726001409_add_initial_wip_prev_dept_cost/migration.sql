-- Costeo por Procesos (B18) — costo del departamento anterior contenido en la
-- existencia inicial en proceso.
--
-- Por qué: al abrir el período siguiente, la existencia final de cada
-- departamento pasa a ser la existencia inicial del mes nuevo. Para los
-- departamentos sucesivos (sequence > 1) esa existencia ya trae adentro un
-- costo transferido de la etapa previa (costo modificado + CAUP). El motor lo
-- acepta por input (`initialWipTransferredCost`), pero no había ninguna
-- columna donde guardarlo: al abrir el mes siguiente volvía en 0 y el informe
-- de costos subvaluaba el inventario inicial.
--
-- Migración ADITIVA e IDEMPOTENTE: un solo ADD COLUMN IF NOT EXISTS, nullable
-- y sin default. No toca ni borra ninguna columna existente, y sobrevive dos
-- corridas (`scripts/migrate-deploy.mjs` puede re-correr una migración marcada
-- como rolled-back). Las filas ya existentes quedan en NULL, que el mapeo lee
-- como 0 — exactamente el comportamiento que había antes de esta columna.
--
-- RLS: `unit_movement_schedules` ya tiene su política en `prisma/rls.sql`
-- (creada en B04). Agregar una columna no cambia la política, así que no hay
-- nada que actualizar ahí.

-- AlterTable
ALTER TABLE "unit_movement_schedules"
    ADD COLUMN IF NOT EXISTS "initialWipCostPrevDept" DECIMAL(18,4);
