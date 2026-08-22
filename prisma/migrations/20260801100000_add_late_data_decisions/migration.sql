-- Datos que llegan tarde a un período ya cerrado.
--
-- El problema: lo que queda sin terminar en julio es con lo que arranca agosto.
-- Si el 5 de agosto llega una factura de julio y julio se recalcula, agosto
-- cambia también. Recalcular en cascada sin que nadie lo pida convertiría
-- números que el costista ya dio por buenos en números que cambian solos — que
-- es exactamente lo contrario de lo que este producto vende.
--
-- La decisión es del costista. Y si la tomó de antemano en el setup de la
-- estructura, esa elección previa ES su autorización: no hay que molestarlo cada
-- vez. Default: preguntar.
--
-- Migración ADITIVA e IDEMPOTENTE.

-- CreateEnum
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'LateDataPolicy') THEN
        CREATE TYPE "LateDataPolicy" AS ENUM ('ASK', 'CURRENT_PERIOD', 'REOPEN');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'LateDataChoice') THEN
        CREATE TYPE "LateDataChoice" AS ENUM ('CURRENT_PERIOD', 'REOPEN', 'DISCARD');
    END IF;
END $$;

-- AlterTable: la política de la estructura. Default ASK — las estructuras
-- existentes pasan a preguntar, que es el comportamiento más conservador y el
-- único que no toma decisiones de plata en nombre de nadie.
ALTER TABLE "cost_structures"
    ADD COLUMN IF NOT EXISTS "lateDataPolicy" "LateDataPolicy" NOT NULL DEFAULT 'ASK';

-- CreateTable
CREATE TABLE IF NOT EXISTS "late_data_decisions" (
    "id"                UUID NOT NULL,
    "dataPointId"       UUID NOT NULL,
    "structureId"       UUID NOT NULL,
    "userId"            UUID NOT NULL,
    "targetPeriodCode"  TEXT NOT NULL,
    "openPeriodCode"    TEXT,
    "policyAtDetection" "LateDataPolicy" NOT NULL,
    "choice"            "LateDataChoice",
    "reason"            TEXT,
    "resolvedAt"        TIMESTAMPTZ,
    "resolvedBy"        UUID,
    "autoResolved"      BOOLEAN NOT NULL DEFAULT false,
    "createdAt"         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "late_data_decisions_pkey" PRIMARY KEY ("id")
);

-- Un dato no puede tener dos decisiones para el mismo período cerrado: si el
-- clasificador lo reprocesa, cae sobre la que ya existe en vez de duplicar la
-- pregunta al costista.
CREATE UNIQUE INDEX IF NOT EXISTS "late_data_decisions_dataPointId_targetPeriodCode_key"
    ON "late_data_decisions"("dataPointId", "targetPeriodCode");

-- La bandeja del costista: lo pendiente primero (resolvedAt IS NULL).
CREATE INDEX IF NOT EXISTS "late_data_decisions_userId_resolvedAt_idx"
    ON "late_data_decisions"("userId", "resolvedAt");
CREATE INDEX IF NOT EXISTS "late_data_decisions_structureId_resolvedAt_idx"
    ON "late_data_decisions"("structureId", "resolvedAt");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'late_data_decisions_dataPointId_fkey'
    ) THEN
        ALTER TABLE "late_data_decisions"
            ADD CONSTRAINT "late_data_decisions_dataPointId_fkey"
            FOREIGN KEY ("dataPointId") REFERENCES "data_points"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'late_data_decisions_structureId_fkey'
    ) THEN
        ALTER TABLE "late_data_decisions"
            ADD CONSTRAINT "late_data_decisions_structureId_fkey"
            FOREIGN KEY ("structureId") REFERENCES "cost_structures"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
