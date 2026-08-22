-- Quién informó el grado de avance, y cuándo.
--
-- Sin estas columnas el sistema trata igual a un recuento hecho por la oficina
-- técnica y a un número que el costista puso a ojo porque planta no contestaba.
-- Para la cátedra no son lo mismo, y para el que después lee el informe tampoco.
--
-- `countSource` arranca en NOT_COUNTED para las filas que ya existen. No es un
-- default cómodo: es la verdad. De esas filas nadie registró de dónde salió el
-- número, y decir TECHNICAL_OFFICE sería inventarles una procedencia.
--
-- Migración ADITIVA e IDEMPOTENTE. El enum ya existe (migración anterior).

-- AlterTable
ALTER TABLE "unit_movement_schedules"
    ADD COLUMN IF NOT EXISTS "countSource" "CountSource" NOT NULL DEFAULT 'NOT_COUNTED',
    ADD COLUMN IF NOT EXISTS "countedAt"   TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS "countedBy"   UUID;
