-- Generado por scripts/migrate-dev.mjs — issue #72
-- Se filtraron 3 sentencia(s) de deriva ESTRUCTURAL (Prisma no las modela):
--   · índice GIN full-text de la bóveda (vault_chunks_content_tsv_idx)
--   · índice HNSW de embedding semántico (vault_chunks_embedding_idx)
--   · ALTER sobre la columna generada vault_chunks.contentTsv
-- ADITIVA (DOM-06): solo CREATE/ALTER ADD. Sin DROPs sobre tablas con datos.
-- CreateTable
CREATE TABLE "vault_query_log" (
    "id" UUID NOT NULL,
    "question" TEXT NOT NULL,
    "retrieverVersion" TEXT NOT NULL,
    "embeddingModel" TEXT NOT NULL,
    "llmModel" TEXT NOT NULL,
    "chunksReturned" JSONB NOT NULL,
    "confidence" TEXT NOT NULL,
    "answeredFromContext" BOOLEAN NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "userId" UUID,
    "feedbackUseful" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vault_query_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vault_query_log_createdAt_idx" ON "vault_query_log"("createdAt");
