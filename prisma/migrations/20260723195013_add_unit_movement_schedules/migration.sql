-- Costeo por Procesos (B04) — cuadro de movimiento de unidades.
--
-- Una fila por (departamento, período): unidades que entran, se terminan, se
-- transfieren, se pierden y quedan en proceso, con su grado de avance por
-- elemento del costo y los costos del período. Es la entrada que el motor
-- (B17) convierte en producción equivalente e informe de costos.
--
-- Migración ADITIVA e IDEMPOTENTE: solo CREATE de la tabla
-- `unit_movement_schedules`, su índice único y sus dos FKs. No borra ni
-- modifica ninguna columna existente. `scripts/migrate-deploy.mjs` puede
-- re-correr una migración marcada como rolled-back, por eso todo usa
-- IF NOT EXISTS / guardas y sobrevive dos corridas.

-- CreateTable
CREATE TABLE IF NOT EXISTS "unit_movement_schedules" (
    "id"                   UUID NOT NULL,
    "departmentId"         UUID NOT NULL,
    "periodId"             UUID NOT NULL,
    -- Entradas (unidades)
    "initialWip"           DECIMAL(18,4) NOT NULL DEFAULT 0,
    "initialWipMpAvance"   DECIMAL(9,4),
    "initialWipConvAvance" DECIMAL(9,4),
    "startedInProduction"  DECIMAL(18,4),
    "receivedFromPrevious" DECIMAL(18,4),
    "unitIncrease"         DECIMAL(18,4),
    -- Salidas (unidades)
    "transferredOut"       DECIMAL(18,4),
    "finishedInStock"      DECIMAL(18,4) NOT NULL DEFAULT 0,
    "normalLossPct"        DECIMAL(9,4),
    "normalLoss"           DECIMAL(18,4),
    "totalLossReported"    DECIMAL(18,4),
    "extraordinaryLoss"    DECIMAL(18,4),
    "finalWip"             DECIMAL(18,4),
    "finalWipMpAvance"     DECIMAL(9,4),
    "finalWipConvAvance"   DECIMAL(9,4),
    -- Costos del período (por elemento)
    "periodCostMp"         DECIMAL(18,4),
    "periodCostMo"         DECIMAL(18,4),
    "periodCostCif"        DECIMAL(18,4),
    "initialWipCostMp"     DECIMAL(18,4),
    "initialWipCostMo"     DECIMAL(18,4),
    "initialWipCostCif"    DECIMAL(18,4),
    "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"            TIMESTAMP(3) NOT NULL,

    CONSTRAINT "unit_movement_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: refuerza @@unique([departmentId, periodId]) — un solo cuadro de
-- movimiento por departamento y período.
CREATE UNIQUE INDEX IF NOT EXISTS "unit_movement_schedules_departmentId_periodId_key"
  ON "unit_movement_schedules"("departmentId", "periodId");

-- AddForeignKey (guardadas: ADD CONSTRAINT no admite IF NOT EXISTS).
DO $$ BEGIN
  ALTER TABLE "unit_movement_schedules"
    ADD CONSTRAINT "unit_movement_schedules_departmentId_fkey"
    FOREIGN KEY ("departmentId") REFERENCES "process_departments"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "unit_movement_schedules"
    ADD CONSTRAINT "unit_movement_schedules_periodId_fkey"
    FOREIGN KEY ("periodId") REFERENCES "cost_periods"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
