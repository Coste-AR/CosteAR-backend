CREATE TABLE "paquetes_rubro" (
  "id" UUID NOT NULL, "category" TEXT NOT NULL, "companyId" UUID, "structureId" UUID, "periodId" UUID, "userId" UUID,
  "lexicon" JSONB NOT NULL, "icons" JSONB NOT NULL, "variants" JSONB NOT NULL, "seedParameters" JSONB NOT NULL, "alertRules" JSONB NOT NULL, "screens" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "paquetes_rubro_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "paquetes_rubro_company_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE
);
CREATE INDEX "paquetes_rubro_scope_idx" ON "paquetes_rubro"("category", "companyId", "structureId", "periodId");
