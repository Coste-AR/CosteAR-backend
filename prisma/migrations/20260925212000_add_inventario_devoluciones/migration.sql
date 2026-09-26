CREATE TYPE "PoliticaDevolucionInventario" AS ENUM ('COSTO_SALIDA', 'PPP_VIGENTE');

ALTER TABLE "companies"
  ADD COLUMN "politicaDevolucionInventario" "PoliticaDevolucionInventario" NOT NULL DEFAULT 'COSTO_SALIDA';

ALTER TABLE "movimientos_inventario"
  ADD COLUMN "identidadExterna" VARCHAR(200),
  ADD COLUMN "documentoHash" VARCHAR(64),
  ADD CONSTRAINT "movimientos_inventario_identidad_documento_check"
    CHECK (("identidadExterna" IS NULL) = ("documentoHash" IS NULL));

CREATE UNIQUE INDEX "movimientos_inventario_companyId_identidadExterna_documentoHash_key"
  ON "movimientos_inventario"("companyId", "identidadExterna", "documentoHash");
