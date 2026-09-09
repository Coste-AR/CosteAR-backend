-- Ventas por canal y variante (A-15). El promedio se deriva de estas filas;
-- no hay una columna editable que pueda quedar desactualizada.

CREATE TABLE "ventas_producto" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "structureId" UUID NOT NULL,
    "fecha" DATE NOT NULL,
    "canal" TEXT NOT NULL,
    "variante" TEXT NOT NULL,
    "cantidad" DECIMAL(18,4) NOT NULL,
    "precioUnitario" DECIMAL(18,4) NOT NULL,
    "unidadId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "deletedAt" TIMESTAMPTZ,

    CONSTRAINT "ventas_producto_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ventas_producto_cantidad_positiva" CHECK ("cantidad" > 0),
    CONSTRAINT "ventas_producto_precio_no_negativo" CHECK ("precioUnitario" >= 0)
);

CREATE INDEX "ventas_producto_companyId_structureId_fecha_idx"
  ON "ventas_producto"("companyId", "structureId", "fecha");
CREATE INDEX "ventas_producto_companyId_structureId_canal_fecha_idx"
  ON "ventas_producto"("companyId", "structureId", "canal", "fecha");

ALTER TABLE "ventas_producto"
  ADD CONSTRAINT "ventas_producto_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ventas_producto"
  ADD CONSTRAINT "ventas_producto_structureId_fkey"
  FOREIGN KEY ("structureId") REFERENCES "cost_structures"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ventas_producto"
  ADD CONSTRAINT "ventas_producto_unidadId_fkey"
  FOREIGN KEY ("unidadId") REFERENCES "unidades_medida"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
