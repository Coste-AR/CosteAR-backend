CREATE TYPE "EstadoValidacionOrden" AS ENUM ('PENDIENTE', 'VALIDADO', 'MARCADO');
CREATE TYPE "CategoriaCostoDirectoOrden" AS ENUM ('TERCEROS', 'TRANSPORTE', 'GRUA', 'VIATICOS', 'COMPRA_EXCLUSIVA', 'OTRO');
CREATE TYPE "TipoEventoContingencia" AS ENUM ('DESPERDICIO', 'SOBRANTE', 'ROTURA', 'FALLA', 'RETRABAJO');
CREATE TYPE "PoliticaRetrabajo" AS ENUM ('CIF_POOL', 'PERDIDA_PERIODO', 'CAMBIO_CLIENTE');

ALTER TABLE "companies" ADD COLUMN "politicaRetrabajo" "PoliticaRetrabajo" NOT NULL DEFAULT 'CIF_POOL';

CREATE TABLE "costos_directos_orden" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "ordenId" UUID NOT NULL, "etapaId" UUID NOT NULL,
  "userId" UUID NOT NULL, "categoria" "CategoriaCostoDirectoOrden" NOT NULL,
  "importe" DECIMAL(18,4) NOT NULL, "documento" VARCHAR(500), "periodoImputado" DATE NOT NULL,
  "estadoValidacion" "EstadoValidacionOrden" NOT NULL DEFAULT 'PENDIENTE',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "costos_directos_orden_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "costos_directos_orden_ordenId_fkey" FOREIGN KEY ("ordenId") REFERENCES "ordenes_trabajo"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "costos_directos_orden_etapaId_fkey" FOREIGN KEY ("etapaId") REFERENCES "etapas_orden"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "costos_directos_orden_importe_check" CHECK ("importe" > 0)
);
CREATE INDEX "costos_directos_orden_userId_idx" ON "costos_directos_orden"("userId");
CREATE INDEX "costos_directos_orden_ordenId_periodoImputado_idx" ON "costos_directos_orden"("ordenId", "periodoImputado");

CREATE TABLE "eventos_contingencia" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "ordenId" UUID NOT NULL, "etapaId" UUID NOT NULL,
  "userId" UUID NOT NULL, "tipo" "TipoEventoContingencia" NOT NULL,
  "cantidad" DECIMAL(18,4) NOT NULL, "valor" DECIMAL(18,4) NOT NULL, "recupero" DECIMAL(18,4),
  "causa" VARCHAR(500) NOT NULL, "tratamiento" VARCHAR(500) NOT NULL,
  "politicaRetrabajo" "PoliticaRetrabajo", "versionPresupuestoId" UUID,
  "estadoValidacion" "EstadoValidacionOrden" NOT NULL DEFAULT 'PENDIENTE',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "eventos_contingencia_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "eventos_contingencia_ordenId_fkey" FOREIGN KEY ("ordenId") REFERENCES "ordenes_trabajo"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "eventos_contingencia_etapaId_fkey" FOREIGN KEY ("etapaId") REFERENCES "etapas_orden"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "eventos_contingencia_versionPresupuestoId_fkey" FOREIGN KEY ("versionPresupuestoId") REFERENCES "versiones_presupuesto"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "eventos_contingencia_valores_check" CHECK ("cantidad" > 0 AND "valor" >= 0 AND ("recupero" IS NULL OR "recupero" >= 0))
);
CREATE INDEX "eventos_contingencia_userId_idx" ON "eventos_contingencia"("userId");
CREATE INDEX "eventos_contingencia_ordenId_createdAt_idx" ON "eventos_contingencia"("ordenId", "createdAt");
