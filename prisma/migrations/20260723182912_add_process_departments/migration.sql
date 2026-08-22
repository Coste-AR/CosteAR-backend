-- Costeo por Procesos (B03) — departamento de la cadena secuencial.
--
-- Migración ADITIVA e IDEMPOTENTE: solo CREATE de la tabla `process_departments`,
-- sus índices y su FK. No borra ni modifica ninguna columna existente.
-- `scripts/migrate-deploy.mjs` puede re-correr una migración marcada como
-- rolled-back, por eso todo usa IF NOT EXISTS / guardas y sobrevive dos corridas.

-- CreateTable
CREATE TABLE IF NOT EXISTS "process_departments" (
    "id"                              UUID NOT NULL,
    "structureId"                     UUID NOT NULL,
    "name"                            TEXT NOT NULL,
    "sequence"                        INTEGER NOT NULL,
    "defaultConversionAvanceEqualsMO" BOOLEAN NOT NULL DEFAULT true,
    "createdAt"                       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"                       TIMESTAMP(3) NOT NULL,
    "deletedAt"                       TIMESTAMP(3),

    CONSTRAINT "process_departments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "process_departments_structureId_idx"
  ON "process_departments"("structureId");

-- CreateIndex: refuerza @@unique([structureId, sequence]) — no puede haber dos
-- departamentos con el mismo orden dentro de una misma estructura.
CREATE UNIQUE INDEX IF NOT EXISTS "process_departments_structureId_sequence_key"
  ON "process_departments"("structureId", "sequence");

-- AddForeignKey (guardada: ADD CONSTRAINT no admite IF NOT EXISTS).
DO $$ BEGIN
  ALTER TABLE "process_departments"
    ADD CONSTRAINT "process_departments_structureId_fkey"
    FOREIGN KEY ("structureId") REFERENCES "cost_structures"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
