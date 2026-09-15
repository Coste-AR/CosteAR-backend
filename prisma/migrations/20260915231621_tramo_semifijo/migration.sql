-- Generado por scripts/migrate-dev.mjs — issue #72
-- Se filtraron 3 sentencia(s) de deriva ESTRUCTURAL (Prisma no las modela):
--   · índice GIN full-text de la bóveda (vault_chunks_content_tsv_idx)
--   · índice HNSW de embedding semántico (vault_chunks_embedding_idx)
--   · ALTER sobre la columna generada vault_chunks.contentTsv
-- ADITIVA (DOM-06): solo CREATE/ALTER ADD. Sin DROPs sobre tablas con datos.
-- CreateEnum
CREATE TYPE "MetodoTramoSemifijo" AS ENUM ('PUNTOS_EXTREMOS', 'CORRELACION', 'DISPERSION_GRAFICA', 'DECLARADO');

-- CreateTable
CREATE TABLE "tramos_semifijos" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "conceptoId" UUID NOT NULL,
    "porcionFija" DECIMAL(18,6) NOT NULL,
    "porcionVariable" DECIMAL(18,6) NOT NULL,
    "metodo" "MetodoTramoSemifijo" NOT NULL,
    "observacionesBase" JSONB NOT NULL,
    "costoVariableUnitario" DECIMAL(18,6),
    "coeficienteCorrelacion" DECIMAL(18,6),
    "creadoPorUserId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMPTZ,

    CONSTRAINT "tramos_semifijos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tramos_semifijos_companyId_conceptoId_idx" ON "tramos_semifijos"("companyId", "conceptoId");

-- CreateIndex
CREATE INDEX "tramos_semifijos_conceptoId_deletedAt_idx" ON "tramos_semifijos"("conceptoId", "deletedAt");

-- AddForeignKey
ALTER TABLE "tramos_semifijos" ADD CONSTRAINT "tramos_semifijos_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tramos_semifijos" ADD CONSTRAINT "tramos_semifijos_conceptoId_fkey" FOREIGN KEY ("conceptoId") REFERENCES "conceptos_costeo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
