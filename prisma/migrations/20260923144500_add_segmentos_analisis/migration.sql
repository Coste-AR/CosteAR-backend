CREATE TABLE "segmentos_analisis" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "companyId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "parentId" UUID,
  "nombre" VARCHAR(120) NOT NULL,
  "nivel" VARCHAR(20) NOT NULL,
  "produccionConjunta" BOOLEAN NOT NULL DEFAULT false,
  "precioUnitario" DECIMAL(18,6),
  "costoVariableUnitario" DECIMAL(18,6),
  "participacion" DECIMAL(12,10) NOT NULL,
  "costoFijoDirecto" DECIMAL(18,6) NOT NULL,
  "prorrateoIndirectos" DECIMAL(18,6) NOT NULL,
  "coproductos" JSONB NOT NULL DEFAULT '[]',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL,
  "deletedAt" TIMESTAMPTZ,
  CONSTRAINT "segmentos_analisis_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "segmentos_analisis_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "segmentos_analisis_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "segmentos_analisis"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "segmentos_analisis_nivel_check" CHECK ("nivel" IN ('empresa','division','canal','linea')),
  CONSTRAINT "segmentos_analisis_valores_check" CHECK ("participacion" >= 0 AND "participacion" <= 1 AND "costoFijoDirecto" >= 0 AND "prorrateoIndirectos" >= 0),
  CONSTRAINT "segmentos_analisis_r15_check" CHECK (NOT "produccionConjunta" OR "costoVariableUnitario" IS NULL)
);

CREATE INDEX "segmentos_analisis_companyId_parentId_deletedAt_idx" ON "segmentos_analisis"("companyId", "parentId", "deletedAt");
