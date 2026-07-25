-- Costeo por Procesos (B05) — Costos conjuntos.
--
-- En un "punto de separación" un proceso rinde varios productos a partir de un
-- costo compartido (costo conjunto): coproductos, subproductos y desechos. Se
-- crean dos tablas: `joint_cost_allocations` (cabecera: costo conjunto total +
-- método de reparto) y `joint_cost_by_product_lines` (cada línea de producto
-- con sus magnitudes por método). La matemática de los cuatro métodos llega en
-- B11 y se conecta al motor en B17; esta migración solo crea el esquema.
--
-- Migración ADITIVA e IDEMPOTENTE: solo CREATE del enum, las dos tablas, sus
-- índices y sus FKs. No borra ni modifica ninguna columna existente.
-- `scripts/migrate-deploy.mjs` puede re-correr una migración marcada como
-- rolled-back, por eso todo usa IF NOT EXISTS / guardas y sobrevive dos
-- corridas. Postgres no admite CREATE TYPE IF NOT EXISTS: el enum se envuelve
-- en un bloque DO que ignora el error `duplicate_object` en la segunda corrida.

-- CreateEnum (idempotente: CREATE TYPE no acepta IF NOT EXISTS).
DO $$ BEGIN
  CREATE TYPE "JointAllocationMethod" AS ENUM (
    'PHYSICAL_UNITS', 'TECHNICAL_YIELD', 'MARKET_VALUE', 'NET_REALIZABLE_VALUE'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- CreateTable: cabecera del reparto de costos conjuntos.
CREATE TABLE IF NOT EXISTS "joint_cost_allocations" (
    "id"             UUID NOT NULL,
    "structureId"    UUID NOT NULL,
    "departmentId"   UUID NOT NULL,
    "periodId"       UUID NOT NULL,
    "method"         "JointAllocationMethod" NOT NULL,
    "jointCostTotal" DECIMAL(18,4) NOT NULL,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "joint_cost_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable: cada línea de producto que sale del punto de separación.
CREATE TABLE IF NOT EXISTS "joint_cost_by_product_lines" (
    "id"                      UUID NOT NULL,
    "allocationId"            UUID NOT NULL,
    "productName"             TEXT NOT NULL,
    "kind"                    TEXT NOT NULL,
    "unitsObtained"           DECIMAL(18,4) NOT NULL,
    "yieldPct"                DECIMAL(9,4),
    "marketPrice"             DECIMAL(18,4),
    "sellingCostVarPct"       DECIMAL(9,4),
    "sellingCostFixedPerUnit" DECIMAL(18,4),
    "byproductRecognition"    TEXT,
    "allocatedCost"           DECIMAL(18,4),
    "unitCost"                DECIMAL(18,4),

    CONSTRAINT "joint_cost_by_product_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: refuerza @@unique([departmentId, periodId]) — un solo reparto de
-- costos conjuntos por departamento y período.
CREATE UNIQUE INDEX IF NOT EXISTS "joint_cost_allocations_departmentId_periodId_key"
  ON "joint_cost_allocations"("departmentId", "periodId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "joint_cost_allocations_structureId_idx"
  ON "joint_cost_allocations"("structureId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "joint_cost_by_product_lines_allocationId_idx"
  ON "joint_cost_by_product_lines"("allocationId");

-- AddForeignKey (guardadas: ADD CONSTRAINT no admite IF NOT EXISTS).
DO $$ BEGIN
  ALTER TABLE "joint_cost_allocations"
    ADD CONSTRAINT "joint_cost_allocations_structureId_fkey"
    FOREIGN KEY ("structureId") REFERENCES "cost_structures"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "joint_cost_allocations"
    ADD CONSTRAINT "joint_cost_allocations_departmentId_fkey"
    FOREIGN KEY ("departmentId") REFERENCES "process_departments"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "joint_cost_allocations"
    ADD CONSTRAINT "joint_cost_allocations_periodId_fkey"
    FOREIGN KEY ("periodId") REFERENCES "cost_periods"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "joint_cost_by_product_lines"
    ADD CONSTRAINT "joint_cost_by_product_lines_allocationId_fkey"
    FOREIGN KEY ("allocationId") REFERENCES "joint_cost_allocations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
