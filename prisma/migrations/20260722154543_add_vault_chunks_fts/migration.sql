-- AlterTable
ALTER TABLE "vault_chunks"
  ADD COLUMN "contentTsv" tsvector GENERATED ALWAYS AS (to_tsvector('spanish', "content")) STORED;

-- CreateIndex
CREATE INDEX "vault_chunks_content_tsv_idx" ON "vault_chunks" USING gin ("contentTsv");
