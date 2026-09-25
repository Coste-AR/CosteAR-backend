CREATE TYPE "OrigenRotacion" AS ENUM ('DECLARADA');

CREATE TABLE "rotaciones_segmento" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "companyId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "segmentoId" UUID NOT NULL,
  "periodId" UUID NOT NULL,
  "rotacion" DECIMAL(18,6) NOT NULL,
  "origen" "OrigenRotacion" NOT NULL DEFAULT 'DECLARADA',
  "cargadoPor" UUID NOT NULL,
  "fecha" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "rotaciones_segmento_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "rotaciones_segmento_rotacion_check" CHECK ("rotacion" > 0),
  CONSTRAINT "rotaciones_segmento_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "rotaciones_segmento_segmentoId_fkey" FOREIGN KEY ("segmentoId") REFERENCES "segmentos_analisis"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "rotaciones_segmento_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "cost_periods"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE INDEX "rotaciones_segmento_companyId_periodId_segmentoId_fecha_idx" ON "rotaciones_segmento"("companyId", "periodId", "segmentoId", "fecha");
