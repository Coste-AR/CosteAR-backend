-- Producción diaria por lote y variante (A-11). Las variantes no son un enum:
-- las define cada paquete de rubro y pueden crecer sin una migración.

CREATE TABLE "producciones_diarias" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "loteId" UUID NOT NULL,
    "fecha" DATE NOT NULL,
    "variante" TEXT NOT NULL,
    "unidadesProducidas" DECIMAL(18,4) NOT NULL,
    "roturas" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "descartes" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "deletedAt" TIMESTAMPTZ,

    CONSTRAINT "producciones_diarias_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "producciones_diarias_no_negativas"
      CHECK ("unidadesProducidas" >= 0 AND "roturas" >= 0 AND "descartes" >= 0),
    CONSTRAINT "producciones_diarias_mermas_no_superan_produccion"
      CHECK ("roturas" + "descartes" <= "unidadesProducidas")
);

CREATE UNIQUE INDEX "producciones_diarias_companyId_loteId_fecha_variante_key"
  ON "producciones_diarias"("companyId", "loteId", "fecha", "variante");
CREATE INDEX "producciones_diarias_companyId_fecha_idx"
  ON "producciones_diarias"("companyId", "fecha");
CREATE INDEX "producciones_diarias_loteId_fecha_idx"
  ON "producciones_diarias"("loteId", "fecha");

ALTER TABLE "producciones_diarias"
  ADD CONSTRAINT "producciones_diarias_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "producciones_diarias"
  ADD CONSTRAINT "producciones_diarias_companyId_loteId_fkey"
  FOREIGN KEY ("companyId", "loteId")
  REFERENCES "lotes_productivos"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
