CREATE TYPE "PoliticaPrimaExtra" AS ENUM ('DENTRO_DE_TARIFA', 'DIRECTA_CON_CAUSA');
CREATE TYPE "EstadoParteHoras" AS ENUM ('CARGADO', 'APROBADO');

ALTER TABLE "companies" ADD COLUMN "politicaPrimaExtra" "PoliticaPrimaExtra" NOT NULL DEFAULT 'DENTRO_DE_TARIFA';

CREATE TABLE "tarifas_mano_obra" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "companyId" UUID NOT NULL, "userId" UUID NOT NULL,
  "nombre" VARCHAR(160) NOT NULL, "basicRemuneration" DECIMAL(18,4) NOT NULL,
  "hoursWorked" DECIMAL(18,4) NOT NULL, "productiveHours" DECIMAL(18,4), "standardHours" DECIMAL(18,4),
  "itcsPct" DECIMAL(9,4) NOT NULL, "primaExtraPct" DECIMAL(9,4) NOT NULL DEFAULT 50,
  "vigenteDesde" DATE NOT NULL, "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tarifas_mano_obra_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tarifas_mano_obra_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "tarifas_mano_obra_valores_check" CHECK ("basicRemuneration" >= 0 AND "hoursWorked" > 0 AND "itcsPct" >= 0 AND "primaExtraPct" >= 0)
);
CREATE INDEX "tarifas_mano_obra_userId_idx" ON "tarifas_mano_obra"("userId");
CREATE INDEX "tarifas_mano_obra_companyId_vigenteDesde_idx" ON "tarifas_mano_obra"("companyId", "vigenteDesde");

CREATE TABLE "partes_horas" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "ordenId" UUID NOT NULL, "etapaId" UUID NOT NULL,
  "userId" UUID NOT NULL, "personaId" UUID NOT NULL, "fecha" DATE NOT NULL,
  "horasNormales" DECIMAL(10,4) NOT NULL, "horasExtra" DECIMAL(10,4) NOT NULL, "tarifaId" UUID NOT NULL,
  "tarifaHora" DECIMAL(18,4) NOT NULL, "primaExtraHora" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "causaExtra" VARCHAR(500), "versionPresupuestoId" UUID, "estado" "EstadoParteHoras" NOT NULL DEFAULT 'CARGADO',
  "importeMod" DECIMAL(18,4), "incluyeBaseHorasTaller" BOOLEAN NOT NULL DEFAULT true,
  "aprobadoPor" UUID, "aprobadoAt" TIMESTAMPTZ, "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "partes_horas_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "partes_horas_ordenId_fkey" FOREIGN KEY ("ordenId") REFERENCES "ordenes_trabajo"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "partes_horas_etapaId_fkey" FOREIGN KEY ("etapaId") REFERENCES "etapas_orden"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "partes_horas_tarifaId_fkey" FOREIGN KEY ("tarifaId") REFERENCES "tarifas_mano_obra"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "partes_horas_versionPresupuestoId_fkey" FOREIGN KEY ("versionPresupuestoId") REFERENCES "versiones_presupuesto"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "partes_horas_horas_check" CHECK ("horasNormales" >= 0 AND "horasExtra" >= 0 AND "horasNormales" + "horasExtra" > 0)
);
CREATE INDEX "partes_horas_userId_idx" ON "partes_horas"("userId");
CREATE INDEX "partes_horas_ordenId_fecha_idx" ON "partes_horas"("ordenId", "fecha");
