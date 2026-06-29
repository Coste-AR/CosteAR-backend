-- Aislamiento de datos por producto: cada DataEntry puede apuntar a una
-- estructura de costos específica. Al aprobar, la auto-población va a esa
-- estructura (no a "la activa"), evitando mezclar datos de distintos productos.
ALTER TABLE "data_entries" ADD COLUMN "costStructureId" UUID;

ALTER TABLE "data_entries"
  ADD CONSTRAINT "data_entries_costStructureId_fkey"
  FOREIGN KEY ("costStructureId") REFERENCES "cost_structures"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "data_entries_costStructureId_idx" ON "data_entries"("costStructureId");
