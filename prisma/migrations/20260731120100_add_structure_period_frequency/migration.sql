-- Frecuencia de costeo POR ESTRUCTURA.
--
-- Por qué: hasta ahora el ritmo era uno solo para toda la empresa
-- (`companies.periodicity`). No alcanza — una misma empresa puede costear un
-- producto por mes y otro cada 15 días —, y además la frecuencia se decide al
-- armar la estructura de costos, no al dar de alta la empresa.
--
-- Las tres columnas son NULLABLE y SIN DEFAULT a propósito: `periodicity NULL`
-- significa "heredo el ritmo de la empresa", que es literalmente lo que hacían
-- todas las estructuras hasta hoy. Ninguna fila existente cambia de
-- comportamiento y no hay backfill que correr.
--
-- Migración ADITIVA e IDEMPOTENTE: solo ADD COLUMN IF NOT EXISTS y una guarda
-- para el CHECK. Sobrevive dos corridas.
--
-- RLS: `cost_structures` ya tiene su política en `prisma/rls.sql`. Agregar
-- columnas no la cambia, así que no hay nada que actualizar ahí.

-- AlterTable
ALTER TABLE "cost_structures"
    ADD COLUMN IF NOT EXISTS "periodicity"      "Periodicity",
    ADD COLUMN IF NOT EXISTS "periodLengthDays" INTEGER,
    ADD COLUMN IF NOT EXISTS "periodAnchorDate" DATE;

-- El invariante en la base, no solo en la app: "cada 10 días" sin fecha de
-- inicio no define ningún período concreto, y guardar un largo de ciclo en una
-- estructura mensual deja basura que después alguien lee como si significara
-- algo. Cualquiera de los dos casos es un bug, y este CHECK lo corta acá.
--
-- El largo se topea en 366 días: más de un año ya es otro ritmo, y un número
-- absurdo (0, negativo, 10.000) haría que el calendario genere períodos
-- imposibles en silencio.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'cost_structures_custom_days_check'
    ) THEN
        ALTER TABLE "cost_structures"
            ADD CONSTRAINT "cost_structures_custom_days_check" CHECK (
                CASE
                    WHEN "periodicity" = 'CUSTOM_DAYS' THEN
                        "periodLengthDays" IS NOT NULL
                        AND "periodLengthDays" BETWEEN 1 AND 366
                        AND "periodAnchorDate" IS NOT NULL
                    ELSE
                        "periodLengthDays" IS NULL
                        AND "periodAnchorDate" IS NULL
                END
            );
    END IF;
END $$;
