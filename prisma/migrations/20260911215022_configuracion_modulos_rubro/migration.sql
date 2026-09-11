-- Generado por scripts/migrate-dev.mjs — issue #72
-- Se filtraron 3 sentencia(s) de deriva ESTRUCTURAL (Prisma no las modela):
--   · índice GIN full-text de la bóveda (vault_chunks_content_tsv_idx)
--   · índice HNSW de embedding semántico (vault_chunks_embedding_idx)
--   · ALTER sobre la columna generada vault_chunks.contentTsv
-- ADITIVA (DOM-06): solo CREATE/ALTER ADD. Sin DROPs sobre tablas con datos.
-- AlterTable
ALTER TABLE "paquetes_rubro" ADD COLUMN     "modulos" JSONB NOT NULL DEFAULT '[]';

-- CreateTable
CREATE TABLE "configuracion_modulos_rubro" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "moduleId" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "configuracion_modulos_rubro_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "configuracion_modulos_rubro_userId_idx" ON "configuracion_modulos_rubro"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "configuracion_modulos_rubro_companyId_moduleId_key" ON "configuracion_modulos_rubro"("companyId", "moduleId");

-- AddForeignKey
ALTER TABLE "configuracion_modulos_rubro" ADD CONSTRAINT "configuracion_modulos_rubro_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
