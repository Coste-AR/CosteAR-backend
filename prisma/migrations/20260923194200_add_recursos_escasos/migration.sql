CREATE TABLE "recursos_escasos" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "companyId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "clave" VARCHAR(80) NOT NULL,
  "unidadId" UUID NOT NULL,
  "disponibleEnPeriodo" DECIMAL(18,6) NOT NULL,
  "esCuelloDeBotellaActivo" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL,
  "deletedAt" TIMESTAMPTZ,
  CONSTRAINT "recursos_escasos_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "recursos_escasos_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "recursos_escasos_unidadId_fkey" FOREIGN KEY ("unidadId") REFERENCES "unidades_medida"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "recursos_escasos_disponible_check" CHECK ("disponibleEnPeriodo" >= 0)
);

CREATE UNIQUE INDEX "recursos_escasos_companyId_clave_key" ON "recursos_escasos"("companyId", "clave");
CREATE INDEX "recursos_escasos_companyId_esCuelloDeBotellaActivo_deletedAt_idx" ON "recursos_escasos"("companyId", "esCuelloDeBotellaActivo", "deletedAt");

CREATE TABLE "consumos_recurso_por_unidad" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "companyId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "recursoId" UUID NOT NULL,
  "segmentoId" UUID NOT NULL,
  "consumoPorUnidad" DECIMAL(18,6) NOT NULL,
  "demandaMaxima" DECIMAL(18,6) NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL,
  "deletedAt" TIMESTAMPTZ,
  CONSTRAINT "consumos_recurso_por_unidad_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "consumos_recurso_por_unidad_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "consumos_recurso_por_unidad_recursoId_fkey" FOREIGN KEY ("recursoId") REFERENCES "recursos_escasos"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "consumos_recurso_por_unidad_segmentoId_fkey" FOREIGN KEY ("segmentoId") REFERENCES "segmentos_analisis"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "consumos_recurso_por_unidad_valores_check" CHECK ("consumoPorUnidad" > 0 AND "demandaMaxima" >= 0)
);

CREATE UNIQUE INDEX "consumos_recurso_por_unidad_recursoId_segmentoId_key" ON "consumos_recurso_por_unidad"("recursoId", "segmentoId");
CREATE INDEX "consumos_recurso_por_unidad_companyId_recursoId_deletedAt_idx" ON "consumos_recurso_por_unidad"("companyId", "recursoId", "deletedAt");
