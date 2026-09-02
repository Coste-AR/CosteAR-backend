-- Stock de producto terminado (A-14): la existencia no se materializa.
-- Cada egreso apunta a la producción diaria que consume, de modo que la edad
-- del saldo se conserva por partida y A-15 podrá enlazar una venta después.

CREATE TABLE "egresos_producto" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "produccionId" UUID NOT NULL,
    "cantidad" DECIMAL(18,4) NOT NULL,
    "fecha" DATE NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "egresos_producto_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "egresos_producto_cantidad_positiva" CHECK ("cantidad" > 0)
);

CREATE INDEX "egresos_producto_companyId_produccionId_fecha_idx"
  ON "egresos_producto"("companyId", "produccionId", "fecha");

ALTER TABLE "egresos_producto"
  ADD CONSTRAINT "egresos_producto_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "egresos_producto"
  ADD CONSTRAINT "egresos_producto_produccionId_fkey"
  FOREIGN KEY ("produccionId") REFERENCES "producciones_diarias"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
