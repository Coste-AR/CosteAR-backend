-- Generado por scripts/migrate-dev.mjs — issue #72
-- Se filtraron 3 sentencia(s) de deriva ESTRUCTURAL (Prisma no las modela):
--   · índice GIN full-text de la bóveda (vault_chunks_content_tsv_idx)
--   · índice HNSW de embedding semántico (vault_chunks_embedding_idx)
--   · ALTER sobre la columna generada vault_chunks.contentTsv
-- ADITIVA (DOM-06): solo CREATE/ALTER ADD. Sin DROPs sobre tablas con datos.
-- CreateTable
CREATE TABLE "classifier_ai_calls" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "dataEntryId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "costistId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "latencyMs" INTEGER NOT NULL,
    "estimatedCost" DECIMAL(18,10),
    "costCurrency" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "classifier_ai_calls_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "classifier_ai_calls_companyId_createdAt_idx" ON "classifier_ai_calls"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "classifier_ai_calls_costistId_createdAt_idx" ON "classifier_ai_calls"("costistId", "createdAt");

-- CreateIndex
CREATE INDEX "classifier_ai_calls_dataEntryId_idx" ON "classifier_ai_calls"("dataEntryId");

-- AddForeignKey
ALTER TABLE "classifier_ai_calls" ADD CONSTRAINT "classifier_ai_calls_dataEntryId_fkey" FOREIGN KEY ("dataEntryId") REFERENCES "data_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classifier_ai_calls" ADD CONSTRAINT "classifier_ai_calls_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
