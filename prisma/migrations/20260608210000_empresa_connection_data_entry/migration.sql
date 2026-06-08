-- CreateEnum
CREATE TYPE "DataEntryStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CORRECTED');

-- CreateEnum
CREATE TYPE "DataEntrySourceType" AS ENUM ('TEXT', 'PDF', 'IMAGE', 'WHATSAPP');

-- CreateTable: empresa_connections
CREATE TABLE "empresa_connections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "companyId" UUID NOT NULL,
    "costistId" UUID NOT NULL,
    "apiKey" UUID NOT NULL DEFAULT gen_random_uuid(),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "empresa_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable: data_entries
CREATE TABLE "data_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "connectionId" UUID NOT NULL,
    "costistId" UUID NOT NULL,
    "rawContent" TEXT NOT NULL,
    "sourceType" "DataEntrySourceType" NOT NULL DEFAULT 'TEXT',
    "status" "DataEntryStatus" NOT NULL DEFAULT 'PENDING',
    "correctedContent" TEXT,
    "reviewNote" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "data_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable: validation_history
CREATE TABLE "validation_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "entryId" UUID NOT NULL,
    "costistId" UUID NOT NULL,
    "fromStatus" "DataEntryStatus" NOT NULL,
    "toStatus" "DataEntryStatus" NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "validation_history_pkey" PRIMARY KEY ("id")
);

-- CreateUniqueIndex: empresa_connections.apiKey
CREATE UNIQUE INDEX "empresa_connections_apiKey_key" ON "empresa_connections"("apiKey");

-- CreateUniqueIndex: empresa_connections.(companyId, costistId)
CREATE UNIQUE INDEX "empresa_connections_companyId_costistId_key" ON "empresa_connections"("companyId", "costistId");

-- CreateIndex
CREATE INDEX "empresa_connections_costistId_idx" ON "empresa_connections"("costistId");
CREATE INDEX "data_entries_connectionId_idx" ON "data_entries"("connectionId");
CREATE INDEX "data_entries_costistId_status_idx" ON "data_entries"("costistId", "status");
CREATE INDEX "validation_history_entryId_idx" ON "validation_history"("entryId");

-- AddForeignKey
ALTER TABLE "empresa_connections" ADD CONSTRAINT "empresa_connections_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "empresa_connections" ADD CONSTRAINT "empresa_connections_costistId_fkey"
    FOREIGN KEY ("costistId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "data_entries" ADD CONSTRAINT "data_entries_connectionId_fkey"
    FOREIGN KEY ("connectionId") REFERENCES "empresa_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "validation_history" ADD CONSTRAINT "validation_history_entryId_fkey"
    FOREIGN KEY ("entryId") REFERENCES "data_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Trigger: auto-update updatedAt for empresa_connections and data_entries
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN NEW."updatedAt" = NOW(); RETURN NEW; END;
$$ language 'plpgsql';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_empresa_connections_updated_at') THEN
    CREATE TRIGGER set_empresa_connections_updated_at
      BEFORE UPDATE ON "empresa_connections"
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_data_entries_updated_at') THEN
    CREATE TRIGGER set_data_entries_updated_at
      BEFORE UPDATE ON "data_entries"
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;
