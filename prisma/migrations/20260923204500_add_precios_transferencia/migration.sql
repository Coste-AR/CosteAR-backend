CREATE TYPE "CriterioPrecioTransferencia" AS ENUM ('MERCADO', 'COSTO_VARIABLE', 'PRECIO_EN_BLOQUE');
CREATE TABLE "precios_transferencia" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "companyId" UUID NOT NULL, "userId" UUID NOT NULL,
  "segmentoOrigenId" UUID NOT NULL, "segmentoDestinoId" UUID NOT NULL, "conceptoId" UUID NOT NULL, "periodId" UUID NOT NULL,
  "criterio" "CriterioPrecioTransferencia" NOT NULL, "valor" DECIMAL(18,6) NOT NULL, "unidad" VARCHAR(80) NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "precios_transferencia_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "precios_transferencia_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "precios_transferencia_segmentoOrigenId_fkey" FOREIGN KEY ("segmentoOrigenId") REFERENCES "segmentos_analisis"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "precios_transferencia_segmentoDestinoId_fkey" FOREIGN KEY ("segmentoDestinoId") REFERENCES "segmentos_analisis"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "precios_transferencia_conceptoId_fkey" FOREIGN KEY ("conceptoId") REFERENCES "conceptos_costeo"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "precios_transferencia_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "cost_periods"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);
CREATE UNIQUE INDEX "precios_transferencia_periodId_segmentoOrigenId_segmentoDestinoId_conceptoId_criterio_key" ON "precios_transferencia"("periodId", "segmentoOrigenId", "segmentoDestinoId", "conceptoId", "criterio");
CREATE INDEX "precios_transferencia_companyId_periodId_segmentoDestinoId_idx" ON "precios_transferencia"("companyId", "periodId", "segmentoDestinoId");
