CREATE TYPE "TipoMovimientoDeposito" AS ENUM ('INGRESO', 'EGRESO');

CREATE TABLE "depositos" (
  "id" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "referencia" TEXT NOT NULL,
  "capacidad" DECIMAL(18,4) NOT NULL,
  "unidadId" UUID NOT NULL,
  "umbralBajo" DECIMAL(18,4) NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL,
  "deletedAt" TIMESTAMPTZ,
  CONSTRAINT "depositos_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "depositos_capacidad_positiva" CHECK ("capacidad" > 0),
  CONSTRAINT "depositos_umbral_valido" CHECK ("umbralBajo" >= 0 AND "umbralBajo" <= "capacidad")
);
CREATE UNIQUE INDEX "depositos_companyId_referencia_key" ON "depositos"("companyId", "referencia");
CREATE INDEX "depositos_companyId_idx" ON "depositos"("companyId");
ALTER TABLE "depositos" ADD CONSTRAINT "depositos_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "depositos" ADD CONSTRAINT "depositos_unidadId_fkey"
  FOREIGN KEY ("unidadId") REFERENCES "unidades_medida"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "movimientos_deposito" (
  "id" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "depositoId" UUID NOT NULL,
  "tipo" "TipoMovimientoDeposito" NOT NULL,
  "cantidad" DECIMAL(18,4) NOT NULL,
  "fecha" DATE NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "movimientos_deposito_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "movimientos_deposito_cantidad_positiva" CHECK ("cantidad" > 0)
);
CREATE INDEX "movimientos_deposito_companyId_depositoId_fecha_idx" ON "movimientos_deposito"("companyId", "depositoId", "fecha");
ALTER TABLE "movimientos_deposito" ADD CONSTRAINT "movimientos_deposito_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "movimientos_deposito" ADD CONSTRAINT "movimientos_deposito_depositoId_fkey"
  FOREIGN KEY ("depositoId") REFERENCES "depositos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
