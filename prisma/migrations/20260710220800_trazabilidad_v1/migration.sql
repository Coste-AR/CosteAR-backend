-- CreateEnum
CREATE TYPE "SourceArea" AS ENUM ('deposito', 'contaduria', 'planta', 'comercial', 'costista', 'sistema');

-- CreateEnum
CREATE TYPE "CaptureMethod" AS ENUM ('manual', 'portal_operador', 'ia_sugerido', 'excel_import', 'calculado');

-- CreateEnum
CREATE TYPE "DataStatus" AS ENUM ('borrador', 'validado', 'aplicado', 'anulado');

-- DropForeignKey
ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_userId_fkey";

-- DropTable
DROP TABLE "audit_logs";

-- CreateTable
CREATE TABLE "audit_log" (
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

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_points" (
    "id" UUID NOT NULL,
    "structureId" UUID NOT NULL,
    "element" TEXT NOT NULL,
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
    "sourceDpVersionIds" UUID[],

    CONSTRAINT "calculation_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_log_entityType_entityId_at_idx" ON "audit_log"("entityType", "entityId", "at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "data_point_versions_dataPointId_versionN_key" ON "data_point_versions"("dataPointId", "versionN");

-- CreateIndex
CREATE UNIQUE INDEX "calculation_runs_structureId_runN_key" ON "calculation_runs"("structureId", "runN");

-- CreateIndex
CREATE INDEX "calculation_nodes_runId_parentId_ord_idx" ON "calculation_nodes"("runId", "parentId", "ord");

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

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
ALTER TABLE "calculation_runs" ADD CONSTRAINT "calculation_runs_structureId_fkey" FOREIGN KEY ("structureId") REFERENCES "cost_structures"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calculation_runs" ADD CONSTRAINT "calculation_runs_executedBy_fkey" FOREIGN KEY ("executedBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calculation_nodes" ADD CONSTRAINT "calculation_nodes_runId_fkey" FOREIGN KEY ("runId") REFERENCES "calculation_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calculation_nodes" ADD CONSTRAINT "calculation_nodes_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "calculation_nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE FUNCTION forbid_mutation() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'append-only: % no admite UPDATE/DELETE', TG_TABLE_NAME; END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER t_dpv_ro BEFORE UPDATE OR DELETE ON data_point_versions
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER t_audit_ro BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
