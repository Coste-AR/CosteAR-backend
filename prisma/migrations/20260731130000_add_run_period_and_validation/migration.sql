-- La corrida sabe a qué período pertenece, y si un humano la miró.
--
-- Por qué: `calculation_runs` colgaba solo de la estructura. Alcanzaba mientras
-- calculaba únicamente el costista, a mano — la última corrida era, por
-- definición, la que valía. Con el recálculo diario automático deja de alcanzar:
-- hay que saber de qué período es cada corrida y cuáles pasaron por un humano.
--
-- Migración ADITIVA e IDEMPOTENTE. Cada bloque se aplica SOLO si la columna
-- todavía no existe, porque los backfills no son repetibles: correr de nuevo
-- `UPDATE ... SET validated = true` marcaría como validadas las corridas
-- automáticas que se hayan creado después. La guarda no es cosmética.

-- CreateEnum
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RunTrigger') THEN
        CREATE TYPE "RunTrigger" AS ENUM ('MANUAL', 'AUTO_DAILY', 'CLOSE');
    END IF;
END $$;

-- AlterTable + backfill de `trigger`.
-- El default MANUAL ya deja bien a las filas existentes: todas las corridas de
-- hasta hoy las disparó una persona apretando "calcular". No hay UPDATE que
-- correr.
ALTER TABLE "calculation_runs"
    ADD COLUMN IF NOT EXISTS "trigger" "RunTrigger" NOT NULL DEFAULT 'MANUAL';

-- AlterTable + backfill de `validated`.
--
-- Las corridas existentes se marcan validadas porque las ejecutó un humano a
-- mano: decir lo contrario sería falsear el historial hacia atrás. Las nuevas
-- nacen en false y solo pasan a true cuando alguien las valida.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'calculation_runs' AND column_name = 'validated'
    ) THEN
        ALTER TABLE "calculation_runs"
            ADD COLUMN "validated"   BOOLEAN NOT NULL DEFAULT false,
            ADD COLUMN "validatedAt" TIMESTAMPTZ,
            ADD COLUMN "validatedBy" UUID;

        UPDATE "calculation_runs"
           SET "validated"   = true,
               "validatedAt" = "executedAt",
               "validatedBy" = "executedBy";
    END IF;
END $$;

-- AlterTable + backfill de `periodId`.
--
-- Se resuelve por fecha: la corrida pertenece al período de su misma estructura
-- cuyo rango contiene el día en que se ejecutó. Las que no caen en ninguno
-- quedan en NULL — son anteriores al modelo de períodos y el front las muestra
-- como tales. Inventarles un período sería peor que dejarlas sin él.
--
-- ON DELETE SET NULL y no CASCADE: borrar un período no puede borrar la
-- evidencia de que se calculó. La corrida sobrevive huérfana, que es justo lo
-- que pide la trazabilidad.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'calculation_runs' AND column_name = 'periodId'
    ) THEN
        ALTER TABLE "calculation_runs" ADD COLUMN "periodId" UUID;

        ALTER TABLE "calculation_runs"
            ADD CONSTRAINT "calculation_runs_periodId_fkey"
            FOREIGN KEY ("periodId") REFERENCES "cost_periods"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;

        UPDATE "calculation_runs" r
           SET "periodId" = p.id
          FROM "cost_periods" p
         WHERE p."structureId" = r."structureId"
           AND p."deletedAt" IS NULL
           AND r."executedAt"::date BETWEEN p."startDate" AND p."endDate";
    END IF;
END $$;

-- CreateIndex: historial de un período, de la más nueva a la más vieja.
CREATE INDEX IF NOT EXISTS "calculation_runs_periodId_executedAt_idx"
    ON "calculation_runs"("periodId", "executedAt");

-- CreateIndex: "el resultado vigente de esta estructura" = la última validada.
CREATE INDEX IF NOT EXISTS "calculation_runs_structureId_validated_executedAt_idx"
    ON "calculation_runs"("structureId", "validated", "executedAt");
