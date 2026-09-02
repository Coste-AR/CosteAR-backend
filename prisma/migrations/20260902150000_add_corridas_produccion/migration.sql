CREATE TYPE "DestinoCorrida" AS ENUM ('PROPIA', 'TERCEROS');
CREATE TABLE "corridas_produccion" (
  "id" UUID NOT NULL, "companyId" UUID NOT NULL, "userId" UUID NOT NULL,
  "referencia" TEXT NOT NULL, "formula" TEXT NOT NULL,
  "kilosReales" DECIMAL(18,4) NOT NULL, "destino" "DestinoCorrida" NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "corridas_produccion_pkey" PRIMARY KEY ("id"), CONSTRAINT "corridas_kilos_positivos" CHECK ("kilosReales" > 0)
);
CREATE UNIQUE INDEX "corridas_produccion_companyId_referencia_key" ON "corridas_produccion"("companyId", "referencia");
CREATE INDEX "corridas_produccion_companyId_idx" ON "corridas_produccion"("companyId");
ALTER TABLE "corridas_produccion" ADD CONSTRAINT "corridas_produccion_company_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE;
CREATE TABLE "consumos_corrida" (
  "id" UUID NOT NULL, "companyId" UUID NOT NULL, "userId" UUID NOT NULL, "corridaId" UUID NOT NULL,
  "material" TEXT NOT NULL, "cantidad" DECIMAL(18,4) NOT NULL, "costoUnitarioPpp" DECIMAL(18,6) NOT NULL,
  "depositoId" UUID, "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "consumos_corrida_pkey" PRIMARY KEY ("id"), CONSTRAINT "consumos_corrida_positivos" CHECK ("cantidad" > 0 AND "costoUnitarioPpp" >= 0)
);
CREATE INDEX "consumos_corrida_companyId_corridaId_idx" ON "consumos_corrida"("companyId", "corridaId");
ALTER TABLE "consumos_corrida" ADD CONSTRAINT "consumos_corrida_company_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE;
ALTER TABLE "consumos_corrida" ADD CONSTRAINT "consumos_corrida_corrida_fkey" FOREIGN KEY ("corridaId") REFERENCES "corridas_produccion"("id") ON DELETE CASCADE;
