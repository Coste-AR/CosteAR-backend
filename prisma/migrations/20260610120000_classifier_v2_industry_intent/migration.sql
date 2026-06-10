-- Migration: classifier_v2 — industry-aware + intent detection
-- Adds companyId to supplier_fingerprints (scope per empresa)
-- Adds intent, industryCategory, explanation to classification_audits

-- 1. Clear existing fingerprints (dev data, safe to reset)
DELETE FROM "supplier_fingerprints";

-- 2. Drop old unique constraint
DROP INDEX IF EXISTS "supplier_fingerprints_costistId_supplierCuit_key";

-- 3. Add companyId to supplier_fingerprints (required, filled after clearing rows)
ALTER TABLE "supplier_fingerprints" ADD COLUMN "companyId" UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000';
ALTER TABLE "supplier_fingerprints" ALTER COLUMN "companyId" DROP DEFAULT;

-- 4. Create new unique constraint
CREATE UNIQUE INDEX "supplier_fingerprints_costistId_supplierCuit_companyId_key"
  ON "supplier_fingerprints"("costistId", "supplierCuit", "companyId");

-- 5. Add new columns to classification_audits
ALTER TABLE "classification_audits"
  ADD COLUMN IF NOT EXISTS "intent"           TEXT NOT NULL DEFAULT 'DOCUMENTO_FORMAL',
  ADD COLUMN IF NOT EXISTS "industryCategory" TEXT NOT NULL DEFAULT 'DEFAULT',
  ADD COLUMN IF NOT EXISTS "explanation"      TEXT;
