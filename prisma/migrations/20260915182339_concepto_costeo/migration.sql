-- Generado por scripts/migrate-dev.mjs — issue #72
-- Se filtraron 3 sentencia(s) de deriva ESTRUCTURAL (Prisma no las modela):
--   · índice GIN full-text de la bóveda (vault_chunks_content_tsv_idx)
--   · índice HNSW de embedding semántico (vault_chunks_embedding_idx)
--   · ALTER sobre la columna generada vault_chunks.contentTsv
-- ADITIVA (DOM-06): solo CREATE/ALTER ADD. Sin DROPs sobre tablas con datos.
-- CreateEnum
CREATE TYPE "CausaVariabilidad" AS ENUM ('volumen', 'tiempo', 'intensidad_de_uso', 'precio', 'contrato', 'otra');

-- CreateTable
CREATE TABLE "conceptos_costeo" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "structureId" UUID,
    "periodId" UUID,
    "clave" TEXT NOT NULL,
    "descripcion" TEXT,
    "elemento" "CostElement" NOT NULL,
    "comportamientoVolumen" "ComportamientoCosto",
    "causaVariabilidad" "CausaVariabilidad",
    "erogable" BOOLEAN,
    "horizonteErogableMeses" INTEGER,
    "evitable" BOOLEAN,
    "nivelSegmentacion" TEXT,
    "segmentoId" UUID,
    "rangoActividadDesde" DECIMAL(18,6),
    "rangoActividadHasta" DECIMAL(18,6),
    "confirmado" BOOLEAN NOT NULL DEFAULT false,
    "clasificadoPorUserId" UUID,
    "clasificadoEn" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "deletedAt" TIMESTAMPTZ,

    CONSTRAINT "conceptos_costeo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "conceptos_costeo_companyId_clave_idx" ON "conceptos_costeo"("companyId", "clave");

-- CreateIndex
CREATE INDEX "conceptos_costeo_structureId_clave_idx" ON "conceptos_costeo"("structureId", "clave");

-- CreateIndex
CREATE INDEX "conceptos_costeo_periodId_idx" ON "conceptos_costeo"("periodId");

-- CreateIndex
CREATE UNIQUE INDEX "conceptos_costeo_companyId_structureId_periodId_clave_key" ON "conceptos_costeo"("companyId", "structureId", "periodId", "clave");

-- AddForeignKey
ALTER TABLE "conceptos_costeo" ADD CONSTRAINT "conceptos_costeo_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conceptos_costeo" ADD CONSTRAINT "conceptos_costeo_structureId_fkey" FOREIGN KEY ("structureId") REFERENCES "cost_structures"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conceptos_costeo" ADD CONSTRAINT "conceptos_costeo_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "cost_periods"("id") ON DELETE CASCADE ON UPDATE CASCADE;
