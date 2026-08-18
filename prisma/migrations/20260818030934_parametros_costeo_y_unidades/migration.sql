-- Parametros de costeo y unidades de medida (S-02 del vertical avicola).
--
-- ADITIVA (DOM-06): solo CREATE TABLE, CREATE INDEX y ADD CONSTRAINT.
--
-- Prisma habia generado ademas una tanda de DROPs por deriva PREEXISTENTE del
-- schema: DROP CONSTRAINT en cost_config_versions, DROP INDEX sobre los indices
-- de vault_chunks (embedding y content_tsv, que sostienen la busqueda de la
-- boveda) y varios DROP DEFAULT. Nada de eso tiene relacion con esta tarea y
-- borrar esos indices habria roto el RAG en silencio. Se eliminaron a mano.
--
-- La deriva sigue existiendo y hay que resolverla aparte.

-- CreateTable
CREATE TABLE "unidades_medida" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "baseId" UUID,
    "factor" DECIMAL(18,6) NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "deletedAt" TIMESTAMPTZ,

    CONSTRAINT "unidades_medida_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parametros_costeo" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "structureId" UUID,
    "periodId" UUID,
    "clave" TEXT NOT NULL,
    "valorNum" DECIMAL(18,6),
    "valorTexto" TEXT,
    "unidadId" UUID,
    "descripcion" TEXT,
    "confirmado" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "deletedAt" TIMESTAMPTZ,

    CONSTRAINT "parametros_costeo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "unidades_medida_companyId_idx" ON "unidades_medida"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "unidades_medida_companyId_codigo_key" ON "unidades_medida"("companyId", "codigo");

-- CreateIndex
CREATE INDEX "parametros_costeo_companyId_clave_idx" ON "parametros_costeo"("companyId", "clave");

-- CreateIndex
CREATE INDEX "parametros_costeo_structureId_clave_idx" ON "parametros_costeo"("structureId", "clave");

-- CreateIndex
CREATE INDEX "parametros_costeo_periodId_idx" ON "parametros_costeo"("periodId");

-- CreateIndex
CREATE UNIQUE INDEX "parametros_costeo_companyId_structureId_periodId_clave_key" ON "parametros_costeo"("companyId", "structureId", "periodId", "clave");

-- AddForeignKey
ALTER TABLE "unidades_medida" ADD CONSTRAINT "unidades_medida_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unidades_medida" ADD CONSTRAINT "unidades_medida_baseId_fkey" FOREIGN KEY ("baseId") REFERENCES "unidades_medida"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parametros_costeo" ADD CONSTRAINT "parametros_costeo_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parametros_costeo" ADD CONSTRAINT "parametros_costeo_structureId_fkey" FOREIGN KEY ("structureId") REFERENCES "cost_structures"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parametros_costeo" ADD CONSTRAINT "parametros_costeo_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "cost_periods"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parametros_costeo" ADD CONSTRAINT "parametros_costeo_unidadId_fkey" FOREIGN KEY ("unidadId") REFERENCES "unidades_medida"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "cost_ledger_entries_criterioImporteIva_idx" RENAME TO "cost_ledger_entries_companyId_criterioImporteIva_idx";
