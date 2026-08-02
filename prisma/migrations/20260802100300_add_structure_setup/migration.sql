-- Setup previo obligatorio de Costeo por Procesos (el "CTO inicial").
--
-- Problema que resuelve, del acta del 30/07: cuando llega un dato por ingesta
-- (API, audio, imagen, carga manual), el sistema no tiene ninguna información
-- sobre la estructura interna de la empresa, y por eso no puede clasificar el
-- costo por departamento. La solución acordada fue declarar el mapa productivo
-- ANTES de empezar: con eso la IA deja de adivinar y solo tiene que adjudicar.
--
-- `wipCountFrequencyDays` merece una aclaración porque se parece a
-- `periodLengthDays` y no es lo mismo:
--   · periodLengthDays        — cada cuánto QUIERE costear el costista.
--   · wipCountFrequencyDays   — cada cuánto PUEDE relevar la planta.
-- Si la planta releva cada 15 días y el costista pide ciclos de 3, el sistema
-- calcularía tres veces sobre el mismo recuento y le daría apariencia de dato
-- fresco a algo que no lo es. Guardar las dos permite avisarlo.
--
-- Las tres columnas son nullables o con default: ninguna estructura existente
-- cambia. `setupCompletedAt` en NULL para las de PROCESSES que ya existen es
-- correcto — nunca hicieron el setup.
--
-- Migración ADITIVA e IDEMPOTENTE.

-- AlterTable
ALTER TABLE "cost_structures"
    ADD COLUMN IF NOT EXISTS "setupCompletedAt"      TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS "hasJointProducts"      BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "wipCountFrequencyDays" INTEGER;

-- Un ritmo de recuento de 0 o negativo no significa nada, y uno mayor a un año
-- ya no es un recuento periódico. Mismo criterio que el CHECK de CUSTOM_DAYS.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'cost_structures_wip_count_freq_check'
    ) THEN
        ALTER TABLE "cost_structures"
            ADD CONSTRAINT "cost_structures_wip_count_freq_check" CHECK (
                "wipCountFrequencyDays" IS NULL
                OR "wipCountFrequencyDays" BETWEEN 1 AND 366
            );
    END IF;
END $$;
