-- Deduplicación sin CAE: clave fuerte proveedor|nro comprobante
ALTER TABLE "data_entries" ADD COLUMN "dedupeKey" TEXT;
CREATE INDEX "data_entries_connectionId_dedupeKey_idx" ON "data_entries"("connectionId", "dedupeKey");
