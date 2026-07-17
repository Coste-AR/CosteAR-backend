-- Modelo de PERÍODOS — Fase 1 (problema C).
--
-- Migración ADITIVA y REVERSIBLE en la práctica: crea la tabla `cost_periods`,
-- agrega `companies.periodicity`, y VUELCA (copia) cada estructura existente a
-- un período abierto. NO borra ni modifica ninguna columna existente:
-- `cost_structures.period` y sus tres configs quedan intactas y en uso.
-- Si algo sale mal, no se pierde un byte.

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "Periodicity" AS ENUM ('MONTHLY', 'BIWEEKLY', 'QUARTERLY');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "CostPeriodStatus" AS ENUM ('OPEN', 'CLOSED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AlterTable: el ritmo de costeo de la empresa (por defecto, mensual).
ALTER TABLE "companies"
  ADD COLUMN IF NOT EXISTS "periodicity" "Periodicity" NOT NULL DEFAULT 'MONTHLY';

-- CreateTable
CREATE TABLE IF NOT EXISTS "cost_periods" (
    "id"                 UUID NOT NULL DEFAULT gen_random_uuid(),
    "structureId"        UUID NOT NULL,
    "companyId"          UUID NOT NULL,
    "userId"             UUID NOT NULL,
    "code"               TEXT NOT NULL,
    "label"              TEXT NOT NULL,
    "startDate"          DATE NOT NULL,
    "endDate"            DATE NOT NULL,
    "status"             "CostPeriodStatus" NOT NULL DEFAULT 'OPEN',
    "rawMaterialConfig"  JSONB,
    "directLaborConfig"  JSONB,
    "indirectCostConfig" JSONB,
    "salesUnitPrice"     DECIMAL(18,4),
    "salesQuantity"      DECIMAL(18,4),
    "closedAt"           TIMESTAMPTZ,
    "closedBy"           UUID,
    "closedRunId"        UUID,
    "reopenCount"        INTEGER NOT NULL DEFAULT 0,
    "reopenedAt"         TIMESTAMPTZ,
    "reopenReason"       TEXT,
    "createdAt"          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cost_periods_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "cost_periods_structureId_code_key" ON "cost_periods"("structureId", "code");
CREATE INDEX IF NOT EXISTS "cost_periods_companyId_code_idx" ON "cost_periods"("companyId", "code");
CREATE INDEX IF NOT EXISTS "cost_periods_structureId_status_idx" ON "cost_periods"("structureId", "status");

-- AddForeignKey
ALTER TABLE "cost_periods"
  ADD CONSTRAINT "cost_periods_structureId_fkey"
  FOREIGN KEY ("structureId") REFERENCES "cost_structures"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "cost_periods"
  ADD CONSTRAINT "cost_periods_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- BACKFILL: cada estructura existente pasa a tener SU período abierto, con una
-- copia de sus datos. Idempotente (no duplica si se corre dos veces) y seguro
-- (solo toma estructuras cuyo `period` tiene el formato YYYY-MM).
-- ---------------------------------------------------------------------------
INSERT INTO "cost_periods" (
  "id", "structureId", "companyId", "userId", "code", "label",
  "startDate", "endDate", "status",
  "rawMaterialConfig", "directLaborConfig", "indirectCostConfig",
  "salesUnitPrice", "salesQuantity"
)
SELECT
  gen_random_uuid(),
  s."id",
  s."companyId",
  s."userId",
  s."period",
  CASE substring(s."period" from 6 for 2)
    WHEN '01' THEN 'Enero'   WHEN '02' THEN 'Febrero'   WHEN '03' THEN 'Marzo'
    WHEN '04' THEN 'Abril'   WHEN '05' THEN 'Mayo'      WHEN '06' THEN 'Junio'
    WHEN '07' THEN 'Julio'   WHEN '08' THEN 'Agosto'    WHEN '09' THEN 'Septiembre'
    WHEN '10' THEN 'Octubre' WHEN '11' THEN 'Noviembre' WHEN '12' THEN 'Diciembre'
    ELSE s."period"
  END || ' ' || substring(s."period" from 1 for 4),
  to_date(s."period" || '-01', 'YYYY-MM-DD'),
  (to_date(s."period" || '-01', 'YYYY-MM-DD') + INTERVAL '1 month' - INTERVAL '1 day')::date,
  'OPEN'::"CostPeriodStatus",
  s."rawMaterialConfig",
  s."directLaborConfig",
  s."indirectCostConfig",
  s."salesUnitPrice",
  s."salesQuantity"
FROM "cost_structures" s
WHERE s."period" ~ '^\d{4}-\d{2}$'
  AND NOT EXISTS (
    SELECT 1 FROM "cost_periods" p
    WHERE p."structureId" = s."id" AND p."code" = s."period"
  );
