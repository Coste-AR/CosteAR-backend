-- Operación física genérica (A-09). Migración aditiva.

CREATE TABLE "unidades_productivas" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "referencia" TEXT NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "deletedAt" TIMESTAMPTZ,

    CONSTRAINT "unidades_productivas_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "lotes_productivos" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "unidadProductivaId" UUID,
    "referencia" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "deletedAt" TIMESTAMPTZ,

    CONSTRAINT "lotes_productivos_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "unidades_productivas_companyId_id_key"
  ON "unidades_productivas"("companyId", "id");
CREATE UNIQUE INDEX "unidades_productivas_companyId_referencia_key"
  ON "unidades_productivas"("companyId", "referencia");
CREATE INDEX "unidades_productivas_companyId_idx"
  ON "unidades_productivas"("companyId");
CREATE UNIQUE INDEX "lotes_productivos_companyId_referencia_key"
  ON "lotes_productivos"("companyId", "referencia");
CREATE INDEX "lotes_productivos_companyId_idx"
  ON "lotes_productivos"("companyId");
CREATE INDEX "lotes_productivos_unidadProductivaId_idx"
  ON "lotes_productivos"("unidadProductivaId");

ALTER TABLE "unidades_productivas"
  ADD CONSTRAINT "unidades_productivas_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lotes_productivos"
  ADD CONSTRAINT "lotes_productivos_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lotes_productivos"
  ADD CONSTRAINT "lotes_productivos_companyId_unidadProductivaId_fkey"
  FOREIGN KEY ("companyId", "unidadProductivaId")
  REFERENCES "unidades_productivas"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
