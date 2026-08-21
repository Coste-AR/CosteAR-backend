-- Trabajos de terceros (issue #90, ADR 0009).
--
-- Procesos mandados a hacer afuera que son parte del costo de produccion: van
-- como renglon propio del estado de costos, entre el costo normal y el real.
-- NO son un CIP y NO se prorratean (catedra, clase 20).
--
-- ADITIVA (DOM-06): solo ADD COLUMN, con DEFAULT 0 para que las filas que ya
-- existen queden igual que antes. Nada se pisa ni se borra.
--
-- ESCRITA A MANO A PROPOSITO. `prisma migrate diff` contra el historial arrastra
-- deriva preexistente que NO corresponde a este cambio: los DROP INDEX de
-- `vault_chunks` (issue #72, romperian el RAG), un DROP CONSTRAINT de la FK de
-- `cost_config_versions` y varios `ALTER COLUMN ... DROP DEFAULT`. Aplicar eso
-- de arrastre seria destructivo. Mismo criterio que la migracion de reglas de
-- alerta del 19-08.
--
-- OJO CON EL NOMBRE DE LA CARPETA: generado con `date -u`, en UTC, igual que lo
-- hace Prisma. Mezclar hora local con UTC ya rompio una migracion antes.

ALTER TABLE "cost_periods" ADD COLUMN "thirdPartyWork" DECIMAL(18,4) NOT NULL DEFAULT 0;

ALTER TABLE "cost_structures" ADD COLUMN "thirdPartyWork" DECIMAL(18,4) NOT NULL DEFAULT 0;
