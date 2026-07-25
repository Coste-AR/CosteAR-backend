-- CreateTable
CREATE TABLE "company_target_budgets" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "rawMaterialsPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "laborPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cifPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "marginPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_target_budgets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "company_target_budgets_companyId_key" ON "company_target_budgets"("companyId");

-- AddForeignKey
ALTER TABLE "company_target_budgets" ADD CONSTRAINT "company_target_budgets_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
