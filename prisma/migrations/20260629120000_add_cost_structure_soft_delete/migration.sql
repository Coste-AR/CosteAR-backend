-- Soft-delete para estructuras de costos (borrar / recuperar desde la papelera).
ALTER TABLE "cost_structures" ADD COLUMN "deletedAt" TIMESTAMP(3);
