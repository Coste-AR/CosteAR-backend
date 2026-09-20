-- M11-01 / DOM-06: migración exclusivamente aditiva.
CREATE TABLE "price_index_series" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "basePeriodCode" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "price_index_series_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "price_index_series_versions" (
    "id" UUID NOT NULL,
    "seriesId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "price_index_series_versions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "price_index_values" (
    "id" UUID NOT NULL,
    "versionId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "periodCode" TEXT NOT NULL,
    "indexValue" DECIMAL(18,6) NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "price_index_values_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "price_index_series_companyId_key" ON "price_index_series"("companyId");
CREATE INDEX "price_index_series_userId_idx" ON "price_index_series"("userId");
CREATE UNIQUE INDEX "price_index_series_versions_seriesId_version_key" ON "price_index_series_versions"("seriesId", "version");
CREATE INDEX "price_index_series_versions_companyId_createdAt_idx" ON "price_index_series_versions"("companyId", "createdAt");
CREATE UNIQUE INDEX "price_index_values_versionId_periodCode_key" ON "price_index_values"("versionId", "periodCode");
CREATE INDEX "price_index_values_companyId_periodCode_idx" ON "price_index_values"("companyId", "periodCode");

ALTER TABLE "price_index_series" ADD CONSTRAINT "price_index_series_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "price_index_series_versions" ADD CONSTRAINT "price_index_series_versions_seriesId_fkey"
  FOREIGN KEY ("seriesId") REFERENCES "price_index_series"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "price_index_series_versions" ADD CONSTRAINT "price_index_series_versions_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "price_index_values" ADD CONSTRAINT "price_index_values_versionId_fkey"
  FOREIGN KEY ("versionId") REFERENCES "price_index_series_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "price_index_values" ADD CONSTRAINT "price_index_values_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "cost_calculations" ADD COLUMN "priceIndexSeriesVersionId" UUID;
ALTER TABLE "calculation_runs" ADD COLUMN "priceIndexSeriesVersionId" UUID;
CREATE INDEX "cost_calculations_priceIndexSeriesVersionId_idx" ON "cost_calculations"("priceIndexSeriesVersionId");
CREATE INDEX "calculation_runs_priceIndexSeriesVersionId_idx" ON "calculation_runs"("priceIndexSeriesVersionId");
ALTER TABLE "cost_calculations" ADD CONSTRAINT "cost_calculations_priceIndexSeriesVersionId_fkey"
  FOREIGN KEY ("priceIndexSeriesVersionId") REFERENCES "price_index_series_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "calculation_runs" ADD CONSTRAINT "calculation_runs_priceIndexSeriesVersionId_fkey"
  FOREIGN KEY ("priceIndexSeriesVersionId") REFERENCES "price_index_series_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
