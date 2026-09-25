CREATE TYPE "PoliticaPpp" AS ENUM ('MOVIL', 'PERIODO');
CREATE TYPE "TipoMovimientoInventario" AS ENUM ('INGRESO', 'SALIDA', 'DEVOLUCION', 'TRANSFERENCIA', 'AJUSTE');

ALTER TABLE "companies" ADD COLUMN "politicaPpp" "PoliticaPpp" NOT NULL DEFAULT 'MOVIL';

CREATE TABLE "articulos" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "companyId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "codigo" VARCHAR(80) NOT NULL,
  "descripcion" VARCHAR(300) NOT NULL,
  "unidadId" UUID NOT NULL,
  "almacenable" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "articulos_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "articulos_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "articulos_unidadId_fkey" FOREIGN KEY ("unidadId") REFERENCES "unidades_medida"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
);
CREATE UNIQUE INDEX "articulos_companyId_codigo_key" ON "articulos"("companyId", "codigo");
CREATE INDEX "articulos_userId_idx" ON "articulos"("userId");

CREATE TABLE "movimientos_inventario" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "companyId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "articuloId" UUID NOT NULL,
  "depositoId" UUID,
  "tipo" "TipoMovimientoInventario" NOT NULL,
  "cantidad" DECIMAL(18,4) NOT NULL,
  "costoUnitario" DECIMAL(18,4) NOT NULL,
  "fecha" DATE NOT NULL,
  "ordenId" UUID,
  "ordenDestinoId" UUID,
  "movimientoOrigenId" UUID,
  "documento" VARCHAR(300),
  "periodoImputado" DATE NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "movimientos_inventario_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "movimientos_inventario_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "movimientos_inventario_articuloId_fkey" FOREIGN KEY ("articuloId") REFERENCES "articulos"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "movimientos_inventario_depositoId_fkey" FOREIGN KEY ("depositoId") REFERENCES "depositos"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "movimientos_inventario_ordenId_fkey" FOREIGN KEY ("ordenId") REFERENCES "ordenes_trabajo"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "movimientos_inventario_ordenDestinoId_fkey" FOREIGN KEY ("ordenDestinoId") REFERENCES "ordenes_trabajo"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "movimientos_inventario_movimientoOrigenId_fkey" FOREIGN KEY ("movimientoOrigenId") REFERENCES "movimientos_inventario"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
);
CREATE INDEX "movimientos_inventario_companyId_articuloId_fecha_createdAt_idx" ON "movimientos_inventario"("companyId", "articuloId", "fecha", "createdAt");
CREATE INDEX "movimientos_inventario_userId_idx" ON "movimientos_inventario"("userId");
CREATE INDEX "movimientos_inventario_ordenId_idx" ON "movimientos_inventario"("ordenId");
