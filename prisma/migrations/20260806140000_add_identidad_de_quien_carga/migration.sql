-- IDENTIDAD DE QUIEN CARGA CADA DATO (I5).
--
-- Hasta acá la trazabilidad podía decir QUÉ número entró y CUÁNDO, pero en el
-- camino del portal no podía decir QUIÉN lo mandó: el rastro se cortaba en
-- "alguien de esta empresa". Tres columnas, una por pieza:
--
--   a) data_entries.uploadedBy       — qué persona subió el documento.
--   b) operator_memberships.jobTitle — su puesto declarado en esa empresa.
--   c) data_point_versions.actorJobTitle — el puesto ESTAMPADO en la versión.
--
-- Las tres son NULLABLE a propósito. Las filas que ya existen no tienen autor
-- ni puesto, y eso es un hecho del que no hay registro: inventarlo sería peor
-- que decir "no consta". Ningún backfill.
--
-- Sobre (c): el puesto se estampa en la versión y NO se lee de la ficha de la
-- persona al mostrarlo. La gente cambia de puesto, y un dato de marzo tiene que
-- seguir diciendo el puesto que esa persona tenía en marzo. `data_point_versions`
-- ya es append-only por trigger, así que es el lugar correcto para un dato que
-- no se puede reescribir.
--
-- El trigger `data_point_versions_append_only` corta UPDATE y DELETE de FILAS.
-- `ALTER TABLE ... ADD COLUMN` es DDL y no lo dispara.
--
-- Migración ADITIVA e IDEMPOTENTE.

-- (a) Quién subió el documento del portal.
ALTER TABLE "data_entries"
    ADD COLUMN IF NOT EXISTS "uploadedBy" UUID;

-- SET NULL y no CASCADE: si se borra el usuario, el documento y su historial de
-- validación siguen valiendo. Lo que se pierde es el nombre, no la evidencia.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'data_entries_uploadedBy_fkey'
    ) THEN
        ALTER TABLE "data_entries"
            ADD CONSTRAINT "data_entries_uploadedBy_fkey"
            FOREIGN KEY ("uploadedBy") REFERENCES "users"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- "Mis envíos" filtra por persona: sin este índice esa pantalla hace un scan de
-- todos los documentos de la empresa para quedarse con los de uno.
CREATE INDEX IF NOT EXISTS "data_entries_uploadedBy_idx" ON "data_entries" ("uploadedBy");

-- (b) El puesto declarado, por empresa. Va en la membresía y no en `users`
-- porque la misma persona puede ser jefe de depósito en una empresa y asesor
-- externo en otra.
ALTER TABLE "operator_memberships"
    ADD COLUMN IF NOT EXISTS "jobTitle" TEXT;

-- El puesto viaja también en la invitación: cuando el invitado YA tiene cuenta,
-- la membresía recién se crea al aceptar, así que sin esta columna el puesto que
-- tipeó el costista se perdía entre una cosa y la otra.
ALTER TABLE "operator_invites"
    ADD COLUMN IF NOT EXISTS "jobTitle" TEXT;

-- (c) El puesto estampado en la versión del dato.
ALTER TABLE "data_point_versions"
    ADD COLUMN IF NOT EXISTS "actorJobTitle" TEXT;
