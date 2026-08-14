-- T-06 — Procedencia de la clasificación IA en la ficha del dato.
--
-- `data_point_versions.method` ya podía decir 'ia_sugerido', pero no había
-- forma de ir del número al documento que lo originó (ni, a través de él, a la
-- `classification_audits` que explica por qué la IA lo mandó a esa sección).
--
-- Aditiva y nullable a propósito: todo dato cargado a mano legítimamente no
-- tiene documento de origen, y la ficha lee esa ausencia como "sin sello de IA".
--
-- ON DELETE NO ACTION y no SET NULL: esta tabla es append-only por trigger
-- (`data_point_versions_append_only` rechaza TODO update). Un SET NULL en
-- cascada es un UPDATE, así que fallaría igual pero con un error de append-only
-- que no explica nada. NO ACTION dice la verdad: no se borra un documento del
-- que cuelgan números costeados sin purgar antes sus versiones.

ALTER TABLE "data_point_versions" ADD COLUMN "dataEntryId" UUID;

ALTER TABLE "data_point_versions"
  ADD CONSTRAINT "data_point_versions_dataEntryId_fkey"
  FOREIGN KEY ("dataEntryId") REFERENCES "data_entries"("id")
  ON DELETE NO ACTION ON UPDATE CASCADE;

CREATE INDEX "data_point_versions_dataEntryId_idx" ON "data_point_versions"("dataEntryId");
