-- Generado por scripts/migrate-dev.mjs — issue #72
-- Se filtraron 3 sentencia(s) de deriva ESTRUCTURAL (Prisma no las modela):
--   · índice GIN full-text de la bóveda (vault_chunks_content_tsv_idx)
--   · índice HNSW de embedding semántico (vault_chunks_embedding_idx)
--   · ALTER sobre la columna generada vault_chunks.contentTsv
-- ADITIVA (DOM-06): solo CREATE/ALTER ADD. Sin DROPs sobre tablas con datos.
-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "operationScaleUnit" TEXT,
ADD COLUMN     "operationScaleValue" DECIMAL(18,4);

-- AlterTable
ALTER TABLE "paquetes_rubro" ADD COLUMN     "scale" JSONB;
