CREATE TYPE "TipoTramoCosto" AS ENUM ('REEMPLAZA', 'ACUMULA');

CREATE TABLE "tramos_costo" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "companyId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "conceptoId" UUID,
  "segmentoId" UUID,
  "desde" DECIMAL(18,6) NOT NULL,
  "hasta" DECIMAL(18,6),
  "tipo" "TipoTramoCosto" NOT NULL,
  "importeFijo" DECIMAL(18,6) NOT NULL,
  "cmUnitaria" DECIMAL(18,6) NOT NULL,
  "techoFisico" DECIMAL(18,6),
  "techoFuente" TEXT,
  "techoDeclaradoEn" TIMESTAMPTZ,
  "techoDeclaradoPorId" UUID,
  "creadoPorUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt" TIMESTAMPTZ,
  CONSTRAINT "tramos_costo_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tramos_costo_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE,
  CONSTRAINT "tramos_costo_conceptoId_fkey" FOREIGN KEY ("conceptoId") REFERENCES "conceptos_costeo"("id") ON DELETE RESTRICT,
  CONSTRAINT "tramos_costo_objetivo_check" CHECK (("conceptoId" IS NOT NULL) <> ("segmentoId" IS NOT NULL)),
  CONSTRAINT "tramos_costo_rango_check" CHECK ("desde" >= 0 AND ("hasta" IS NULL OR "hasta" > "desde")),
  CONSTRAINT "tramos_costo_importes_check" CHECK ("importeFijo" >= 0 AND "cmUnitaria" > 0),
  CONSTRAINT "tramos_costo_techo_check" CHECK (
    ("techoFisico" IS NULL AND "techoFuente" IS NULL AND "techoDeclaradoEn" IS NULL AND "techoDeclaradoPorId" IS NULL)
    OR
    ("techoFisico" IS NOT NULL AND length(btrim("techoFuente")) > 0 AND "techoDeclaradoEn" IS NOT NULL AND "techoDeclaradoPorId" IS NOT NULL)
  )
);

CREATE INDEX "tramos_costo_companyId_conceptoId_deletedAt_idx" ON "tramos_costo"("companyId", "conceptoId", "deletedAt");
CREATE INDEX "tramos_costo_companyId_segmentoId_deletedAt_idx" ON "tramos_costo"("companyId", "segmentoId", "deletedAt");

ALTER TABLE "tramos_costo" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tramos_costo" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "tramos_costo"
  USING ("userId" = current_app_user_id())
  WITH CHECK ("userId" = current_app_user_id());

CREATE TABLE "equilibrio_tramos_calculos" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "companyId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "tramoCostoIds" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  "resultado" JSONB NOT NULL,
  "creadoPorUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "equilibrio_tramos_calculos_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "equilibrio_tramos_calculos_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE
);
CREATE INDEX "equilibrio_tramos_calculos_companyId_createdAt_idx" ON "equilibrio_tramos_calculos"("companyId", "createdAt");
ALTER TABLE "equilibrio_tramos_calculos" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "equilibrio_tramos_calculos" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "equilibrio_tramos_calculos"
  USING ("userId" = current_app_user_id()) WITH CHECK ("userId" = current_app_user_id());
