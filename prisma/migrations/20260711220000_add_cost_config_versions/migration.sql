-- Versiones append-only de la config del motor (R1). Migración ADITIVA (R7):
-- solo CREATE TABLE + FK + trigger. No toca ni borra nada existente.

-- CreateTable
CREATE TABLE "cost_config_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "structureId" UUID NOT NULL,
    "section" TEXT NOT NULL,
    "versionN" INTEGER NOT NULL,
    "value" JSONB NOT NULL,
    "reason" TEXT,
    "createdBy" UUID,
    "actorRole" TEXT,
    "actorArea" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cost_config_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cost_config_versions_structureId_section_versionN_key" ON "cost_config_versions"("structureId", "section", "versionN");
CREATE INDEX "cost_config_versions_structureId_section_idx" ON "cost_config_versions"("structureId", "section");

-- AddForeignKey
ALTER TABLE "cost_config_versions" ADD CONSTRAINT "cost_config_versions_structureId_fkey" FOREIGN KEY ("structureId") REFERENCES "cost_structures"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- R1: append-only. Reutiliza la función trg_append_only() creada en la
-- migración de trazabilidad. Una vez escrita, una versión de config NO se
-- puede editar ni borrar: la única forma de "corregir" es insertar otra.
CREATE TRIGGER cost_config_versions_append_only
  BEFORE UPDATE OR DELETE ON "cost_config_versions"
  FOR EACH ROW EXECUTE FUNCTION trg_append_only();
