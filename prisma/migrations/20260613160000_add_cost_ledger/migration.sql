-- Libro mayor de costos respaldado por documentos (cierra el círculo validación → costo)
CREATE TABLE "cost_ledger_entries" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "costistId" UUID NOT NULL,
    "dataEntryId" UUID,
    "period" TEXT NOT NULL,
    "costSection" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "supplier" TEXT,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'ARS',
    "docDate" TIMESTAMP(3),
    "sourceImageUrl" TEXT,
    "confidence" INTEGER,
    "aiUsed" BOOLEAN NOT NULL DEFAULT false,
    "wasCorrected" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "cost_ledger_entries_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "cost_ledger_entries_companyId_period_costSection_idx" ON "cost_ledger_entries"("companyId", "period", "costSection");
CREATE INDEX "cost_ledger_entries_costistId_period_idx" ON "cost_ledger_entries"("costistId", "period");
CREATE INDEX "cost_ledger_entries_dataEntryId_idx" ON "cost_ledger_entries"("dataEntryId");
