-- Unidad de medida por departamento + conversión entre etapas (H12).
--
-- El chequeo que cerró H2 (validate-inputs.ts) exige que las unidades que un
-- departamento transfiere sean EXACTAMENTE las que el siguiente recibe. Es
-- correcto para dos departamentos que miden lo mismo, pero una cadena real de
-- citrícola o ingenio (toneladas de fruta → litros de jugo → kilos de
-- concentrado) no tenía dónde declarar que las unidades cambian de nombre
-- entre etapas.
--
-- `unit` es descriptivo (para mostrar en pantalla, no se usa en ninguna
-- cuenta). `conversionFromPrevious` es el factor real: cuántas unidades de
-- ESTE departamento produce cada unidad recibida del anterior. NULL en
-- cualquiera de los dos reproduce el comportamiento actual (factor 1, exige
-- igualdad exacta) — ningún departamento existente cambia de comportamiento.
--
-- Migración ADITIVA e IDEMPOTENTE.

-- AlterTable
ALTER TABLE "process_departments"
    ADD COLUMN IF NOT EXISTS "unit"                   VARCHAR(40),
    ADD COLUMN IF NOT EXISTS "conversionFromPrevious"  DECIMAL(18, 6);

-- Un factor de conversión de cero o negativo no significa nada físicamente
-- (no existe "cada unidad recibida produce -3 unidades").
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'process_departments_conversion_positive_check'
    ) THEN
        ALTER TABLE "process_departments"
            ADD CONSTRAINT "process_departments_conversion_positive_check" CHECK (
                "conversionFromPrevious" IS NULL OR "conversionFromPrevious" > 0
            );
    END IF;
END $$;
