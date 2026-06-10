-- CreateTable
CREATE TABLE "supplier_fingerprints" (
    "id" UUID NOT NULL,
    "costistId" UUID NOT NULL,
    "supplierCuit" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "costSection" TEXT NOT NULL,
    "timesSeenCorrect" INTEGER NOT NULL DEFAULT 0,
    "timesOverridden" INTEGER NOT NULL DEFAULT 0,
    "confidenceBonus" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_fingerprints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "classification_audits" (
    "id" UUID NOT NULL,
    "dataEntryId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "costistId" UUID NOT NULL,
    "qualityGate" TEXT NOT NULL,
    "definitiveSignal" TEXT,
    "corroboratingSignals" JSONB NOT NULL,
    "numericValidationDelta" INTEGER NOT NULL DEFAULT 0,
    "supplierFingerprintUsed" BOOLEAN NOT NULL DEFAULT false,
    "aiUsed" BOOLEAN NOT NULL DEFAULT false,
    "confidenceCap" INTEGER,
    "documentType" TEXT NOT NULL,
    "costSection" TEXT NOT NULL,
    "confidence" INTEGER NOT NULL,
    "requiresReview" BOOLEAN NOT NULL DEFAULT false,
    "validatedByCostista" BOOLEAN NOT NULL DEFAULT false,
    "costaValidatedAt" TIMESTAMP(3),
    "costaOverrode" BOOLEAN NOT NULL DEFAULT false,
    "costaCorrection" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "classification_audits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processed_caes" (
    "id" UUID NOT NULL,
    "cae" TEXT NOT NULL,
    "dataEntryId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_caes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "supplier_fingerprints_costistId_idx" ON "supplier_fingerprints"("costistId");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_fingerprints_costistId_supplierCuit_key" ON "supplier_fingerprints"("costistId", "supplierCuit");

-- CreateIndex
CREATE INDEX "classification_audits_dataEntryId_idx" ON "classification_audits"("dataEntryId");

-- CreateIndex
CREATE INDEX "classification_audits_costistId_idx" ON "classification_audits"("costistId");

-- CreateIndex
CREATE UNIQUE INDEX "processed_caes_cae_key" ON "processed_caes"("cae");

-- CreateIndex
CREATE INDEX "processed_caes_companyId_idx" ON "processed_caes"("companyId");
