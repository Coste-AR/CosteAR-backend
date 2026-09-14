ALTER TABLE "eventos_lote"
  ADD COLUMN "requiereRevision" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "motivoRevision" TEXT;

ALTER TABLE "producciones_diarias"
  ADD COLUMN "requiereRevision" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "motivoRevision" TEXT;
