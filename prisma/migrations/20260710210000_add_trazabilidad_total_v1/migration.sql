-- Trazabilidad Total v1 — modelo de datos (100% aditivo, ver DECISIONES.md).
-- No altera ni borra ninguna tabla/columna existente.

-- CreateEnum
CREATE TYPE "SourceArea" AS ENUM ('deposito', 'contaduria', 'planta', 'comercial', 'costista', 'sistema');

-- CreateEnum
CREATE TYPE "CaptureMethod" AS ENUM ('manual', 'portal_operador', 'ia_sugerido', 'excel_import', 'calculado');

-- CreateEnum
CREATE TYPE "DataStatus" AS ENUM ('borrador', 'validado', 'aplicado', 'anulado');

-- CreateEnum
CREATE TYPE "CostElement" AS ENUM ('MP', 'MOD', 'CIP', 'VENTA');

-- CreateTable
CREATE TABLE "data_points" (
    "id" UUID NOT NULL,
    "structureId" UUID NOT NULL,
    "element" "CostElement" NOT NULL,
    "fieldKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "unit" TEXT,
    "sourceArea" "SourceArea" NOT NULL,
    "status" "DataStatus" NOT NULL DEFAULT 'borrador',
    "fechaHecho" DATE,
    "fechaCaptacion" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "periodoImputado" TEXT,
    "voidedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "data_points_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_point_versions" (
    "id" UUID NOT NULL,
    "dataPointId" UUID NOT NULL,
    "versionN" INTEGER NOT NULL,
    "valueNum" DECIMAL(18,4),
    "valueJson" JSONB,
    "reason" TEXT,
    "evidenceId" UUID,
    "method" "CaptureMethod" NOT NULL,
    "createdBy" UUID NOT NULL,
    "actorRole" TEXT NOT NULL,
    "actorArea" "SourceArea" NOT NULL,
    "deviceInfo" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "data_point_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "counterparty" TEXT,
    "fileUrl" TEXT,
    "uploadedBy" UUID,
    "uploadedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trace_audit_log" (
    "id" BIGSERIAL NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorId" UUID,
    "actorRole" TEXT NOT NULL,
    "actorArea" "SourceArea" NOT NULL,
    "method" "CaptureMethod",
    "deviceInfo" TEXT,
    "before" JSONB,
    "after" JSONB,
    "comment" TEXT,
    "at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trace_audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calculation_runs" (
    "id" UUID NOT NULL,
    "structureId" UUID NOT NULL,
    "runN" INTEGER NOT NULL,
    "engineVersion" TEXT NOT NULL,
    "executedBy" UUID NOT NULL,
    "executedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "inputsSnapshot" JSONB NOT NULL,
    "results" JSONB NOT NULL,

    CONSTRAINT "calculation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calculation_nodes" (
    "id" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "parentId" UUID,
    "ord" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "formula" TEXT,
    "valueNum" DECIMAL(18,4),
    "unit" TEXT,
    "sourceDpVersionIds" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "calculation_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "data_points_structureId_idx" ON "data_points"("structureId");

-- CreateIndex
CREATE INDEX "data_points_structureId_element_idx" ON "data_points"("structureId", "element");

-- CreateIndex
CREATE INDEX "data_points_periodoImputado_idx" ON "data_points"("periodoImputado");

-- CreateIndex
CREATE INDEX "data_point_versions_dataPointId_idx" ON "data_point_versions"("dataPointId");

-- CreateIndex
CREATE UNIQUE INDEX "data_point_versions_dataPointId_versionN_key" ON "data_point_versions"("dataPointId", "versionN");

-- CreateIndex
CREATE INDEX "trace_audit_log_entityType_entityId_at_idx" ON "trace_audit_log"("entityType", "entityId", "at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "calculation_runs_structureId_runN_key" ON "calculation_runs"("structureId", "runN");

-- CreateIndex
CREATE INDEX "calculation_nodes_runId_parentId_ord_idx" ON "calculation_nodes"("runId", "parentId", "ord");

-- AddForeignKey
ALTER TABLE "data_points" ADD CONSTRAINT "data_points_structureId_fkey" FOREIGN KEY ("structureId") REFERENCES "cost_structures"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_point_versions" ADD CONSTRAINT "data_point_versions_dataPointId_fkey" FOREIGN KEY ("dataPointId") REFERENCES "data_points"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_point_versions" ADD CONSTRAINT "data_point_versions_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "evidence"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_point_versions" ADD CONSTRAINT "data_point_versions_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_uploadedBy_fkey" FOREIGN KEY ("uploadedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trace_audit_log" ADD CONSTRAINT "trace_audit_log_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calculation_runs" ADD CONSTRAINT "calculation_runs_structureId_fkey" FOREIGN KEY ("structureId") REFERENCES "cost_structures"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calculation_runs" ADD CONSTRAINT "calculation_runs_executedBy_fkey" FOREIGN KEY ("executedBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calculation_nodes" ADD CONSTRAINT "calculation_nodes_runId_fkey" FOREIGN KEY ("runId") REFERENCES "calculation_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calculation_nodes" ADD CONSTRAINT "calculation_nodes_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "calculation_nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- R1: append-only. `data_point_versions` y `trace_audit_log` nunca se editan
-- ni se borran una vez escritos — cualquier UPDATE/DELETE directo revienta.
-- La única forma de "corregir" un dato es insertar una versión nueva.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION trg_append_only() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'append-only: % no permite UPDATE ni DELETE directo (tabla %)', TG_OP, TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER data_point_versions_append_only
  BEFORE UPDATE OR DELETE ON "data_point_versions"
  FOR EACH ROW EXECUTE FUNCTION trg_append_only();

CREATE TRIGGER trace_audit_log_append_only
  BEFORE UPDATE OR DELETE ON "trace_audit_log"
  FOR EACH ROW EXECUTE FUNCTION trg_append_only();
