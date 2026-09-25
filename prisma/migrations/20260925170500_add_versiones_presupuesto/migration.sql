CREATE TYPE "TipoVersionPresupuesto" AS ENUM ('BASE', 'ADICIONAL', 'REVISION');
CREATE TYPE "EstadoVersionPresupuesto" AS ENUM ('BORRADOR', 'PREPARADO', 'APROBADO', 'RECHAZADO', 'VENCIDO');
CREATE TYPE "ElementoPresupuesto" AS ENUM ('MP', 'MOD', 'CIP', 'TERCEROS', 'ENTREGA');

CREATE TABLE "versiones_presupuesto" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "companyId" UUID NOT NULL, "ordenId" UUID NOT NULL,
  "userId" UUID NOT NULL, "tipo" "TipoVersionPresupuesto" NOT NULL, "numero" INTEGER NOT NULL,
  "vigenteDesde" DATE NOT NULL, "vigenciaDias" INTEGER NOT NULL,
  "estado" "EstadoVersionPresupuesto" NOT NULL DEFAULT 'BORRADOR',
  "costoPrevisto" DECIMAL(18,4) NOT NULL, "precio" DECIMAL(18,4) NOT NULL, "plazoDias" INTEGER NOT NULL,
  "preparadoPor" UUID, "aprobadoPor" UUID, "causaAdicional" VARCHAR(500),
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "versiones_presupuesto_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "versiones_presupuesto_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "versiones_presupuesto_ordenId_fkey" FOREIGN KEY ("ordenId") REFERENCES "ordenes_trabajo"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "versiones_presupuesto_vigencia_check" CHECK ("vigenciaDias" > 0),
  CONSTRAINT "versiones_presupuesto_importes_check" CHECK ("costoPrevisto" >= 0 AND "precio" >= 0 AND "plazoDias" >= 0)
);
CREATE UNIQUE INDEX "versiones_presupuesto_ordenId_numero_key" ON "versiones_presupuesto"("ordenId", "numero");
CREATE UNIQUE INDEX "versiones_presupuesto_base_unica" ON "versiones_presupuesto"("ordenId") WHERE "tipo" = 'BASE';
CREATE INDEX "versiones_presupuesto_userId_idx" ON "versiones_presupuesto"("userId");
CREATE INDEX "versiones_presupuesto_companyId_estado_idx" ON "versiones_presupuesto"("companyId", "estado");

CREATE TABLE "renglones_presupuesto" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "presupuestoId" UUID NOT NULL, "userId" UUID NOT NULL,
  "elemento" "ElementoPresupuesto" NOT NULL, "etapaId" UUID, "cantidad" DECIMAL(18,4) NOT NULL,
  "unidadId" UUID NOT NULL, "precio" DECIMAL(18,4) NOT NULL,
  CONSTRAINT "renglones_presupuesto_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "renglones_presupuesto_presupuestoId_fkey" FOREIGN KEY ("presupuestoId") REFERENCES "versiones_presupuesto"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "renglones_presupuesto_etapaId_fkey" FOREIGN KEY ("etapaId") REFERENCES "etapas_orden"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "renglones_presupuesto_unidadId_fkey" FOREIGN KEY ("unidadId") REFERENCES "unidades_medida"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "renglones_presupuesto_valores_check" CHECK ("cantidad" > 0 AND "precio" >= 0)
);
CREATE INDEX "renglones_presupuesto_userId_idx" ON "renglones_presupuesto"("userId");
CREATE INDEX "renglones_presupuesto_presupuestoId_idx" ON "renglones_presupuesto"("presupuestoId");
