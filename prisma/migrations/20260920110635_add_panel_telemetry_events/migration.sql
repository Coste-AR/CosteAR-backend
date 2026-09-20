-- Generado por scripts/migrate-dev.mjs — issue #72
-- Se filtraron 3 sentencia(s) de deriva ESTRUCTURAL (Prisma no las modela):
--   · índice GIN full-text de la bóveda (vault_chunks_content_tsv_idx)
--   · índice HNSW de embedding semántico (vault_chunks_embedding_idx)
--   · ALTER sobre la columna generada vault_chunks.contentTsv
-- ADITIVA (DOM-06): solo CREATE/ALTER ADD. Sin DROPs sobre tablas con datos.
-- CreateEnum
CREATE TYPE "PanelTelemetryEventType" AS ENUM ('ACCION_TOCADA', 'CARGA_INICIADA', 'CARGA_ABANDONADA', 'CARGA_COMPLETADA');

-- CreateTable
CREATE TABLE "panel_telemetry_events" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "PanelTelemetryEventType" NOT NULL,
    "action" VARCHAR(120) NOT NULL,
    "durationMs" INTEGER,
    "technicalRole" VARCHAR(40) NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "panel_telemetry_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "panel_telemetry_events_companyId_createdAt_idx" ON "panel_telemetry_events"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "panel_telemetry_events_userId_idx" ON "panel_telemetry_events"("userId");

-- AddForeignKey
ALTER TABLE "panel_telemetry_events" ADD CONSTRAINT "panel_telemetry_events_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
