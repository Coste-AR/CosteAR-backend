-- Clasificación para costeo variable (A-03).
--
-- Es aditiva y no tiene DEFAULT: las filas históricas quedan sin clasificación
-- explícita, por lo que ningún cálculo de absorción cambia al desplegarla.

CREATE TYPE "ComportamientoCosto" AS ENUM ('VARIABLE', 'FIJO', 'SEMIFIJO');

ALTER TABLE "parametros_costeo"
  ADD COLUMN "comportamientoVolumen" "ComportamientoCosto",
  ADD COLUMN "clasificadoPorUserId" UUID,
  ADD COLUMN "clasificadoEn" TIMESTAMPTZ;

-- Una clasificación nunca queda separada de su decisión. Las tres columnas son
-- NULL en datos históricos, o las tres están presentes en una decisión nueva.
ALTER TABLE "parametros_costeo"
  ADD CONSTRAINT "parametros_costeo_comportamiento_trazable_check"
  CHECK (
    ("comportamientoVolumen" IS NULL
      AND "clasificadoPorUserId" IS NULL
      AND "clasificadoEn" IS NULL)
    OR
    ("comportamientoVolumen" IS NOT NULL
      AND "clasificadoPorUserId" IS NOT NULL
      AND "clasificadoEn" IS NOT NULL)
  );
