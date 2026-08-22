-- Cuándo corrió por última vez el cálculo automático de este período.
--
-- Por qué: el job diario no debe recalcular porque sí. Si desde la última
-- corrida no llegó ningún dato nuevo, el resultado sería idéntico al anterior y
-- lo único que lograría es enterrar el historial bajo treinta corridas iguales,
-- justo en la pantalla cuyo valor es poder leerlo.
--
-- Con esta marca el job compara contra la última vez que corrió y se saltea los
-- períodos donde no pasó nada — el "standby" que pidió el equipo.
--
-- NULL = nunca corrió automáticamente. La primera corrida del job no se saltea.
--
-- Migración ADITIVA e IDEMPOTENTE: un solo ADD COLUMN IF NOT EXISTS, nullable y
-- sin default. Ninguna fila existente cambia de comportamiento.

-- AlterTable
ALTER TABLE "cost_periods"
    ADD COLUMN IF NOT EXISTS "lastAutoRunAt" TIMESTAMPTZ;
