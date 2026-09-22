-- Generado por scripts/migrate-dev.mjs — issue #72
-- Se filtraron 3 sentencia(s) de deriva ESTRUCTURAL (Prisma no las modela):
--   · índice GIN full-text de la bóveda (vault_chunks_content_tsv_idx)
--   · índice HNSW de embedding semántico (vault_chunks_embedding_idx)
--   · ALTER sobre la columna generada vault_chunks.contentTsv
-- ADITIVA (DOM-06): solo CREATE/ALTER ADD. Sin DROPs sobre tablas con datos.
-- CreateTable
CREATE TABLE "conceptos_costeo_importes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "companyId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "conceptoId" UUID NOT NULL,
    "importeFijo" DECIMAL(18,6),
    "importeVariableUnitario" DECIMAL(18,6),
    "moneda" VARCHAR(3) NOT NULL,
    "unidad" VARCHAR(80) NOT NULL,
    "vigenteDesde" TIMESTAMPTZ NOT NULL,
    "creadoPorUserId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conceptos_costeo_importes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "conceptos_costeo_importes_companyId_conceptoId_vigenteDesde_idx" ON "conceptos_costeo_importes"("companyId", "conceptoId", "vigenteDesde", "createdAt");

-- AddForeignKey
ALTER TABLE "conceptos_costeo_importes" ADD CONSTRAINT "conceptos_costeo_importes_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "conceptos_costeo_importes" ADD CONSTRAINT "conceptos_costeo_importes_conceptoId_fkey" FOREIGN KEY ("conceptoId") REFERENCES "conceptos_costeo"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- DOM-01: una versión publicada no se corrige ni se borra en sitio.
CREATE TRIGGER conceptos_costeo_importes_append_only
  BEFORE UPDATE OR DELETE ON "conceptos_costeo_importes"
  FOR EACH ROW EXECUTE FUNCTION trg_append_only();
