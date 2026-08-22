-- OJO CON EL NOMBRE DE ESTA CARPETA: Prisma aplica las migraciones en orden
-- alfabetico, y esta DEPENDE de la de parametros_costeo (referencia la tabla
-- unidades_medida). Al crearla a mano se uso la hora LOCAL (00:28) mientras que
-- Prisma habia nombrado la anterior con UTC (03:09), asi que esta quedaba
-- primero y fallaba en base limpia con "relation unidades_medida does not exist".
-- Solo se vio en CI: en una base que ya tenia las tablas, el error no aparece.
--
-- Activos amortizables y registro de desperdicio (S-03 y S-04 del vertical avicola).
--
-- ADITIVA (DOM-06): solo CREATE TYPE, CREATE TABLE, CREATE INDEX y ADD CONSTRAINT.
--
-- Igual que en la migracion de parametros_costeo, Prisma agrego sentencias DROP
-- por la deriva PREEXISTENTE del schema (vault_chunks.contentTsv es una columna
-- generada que Prisma no modela). Se eliminaron a mano: incluian los DROP INDEX
-- de vault_chunks, que sostienen la busqueda de la boveda.
--
-- La deriva sigue sin resolverse y va a reaparecer en cada migracion nueva.

-- CreateEnum
CREATE TYPE "NaturalezaDesperdicio" AS ENUM ('NORMAL', 'EXTRAORDINARIA');

-- CreateTable
CREATE TABLE "activos_amortizables" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "structureId" UUID,
    "nombre" TEXT NOT NULL,
    "costoAdquisicion" DECIMAL(18,4) NOT NULL,
    "valorResidual" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "vidaUtilMeses" INTEGER,
    "fechaAlta" DATE NOT NULL,
    "cantidad" DECIMAL(18,4),
    "unidadId" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "deletedAt" TIMESTAMPTZ,

    CONSTRAINT "activos_amortizables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "desperdicio_registros" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "periodId" UUID,
    "concepto" TEXT NOT NULL,
    "valor" DECIMAL(18,4) NOT NULL,
    "cantidad" DECIMAL(18,4),
    "unidadId" UUID,
    "naturaleza" "NaturalezaDesperdicio",
    "valorRecupero" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "motivo" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "deletedAt" TIMESTAMPTZ,

    CONSTRAINT "desperdicio_registros_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "activos_amortizables_companyId_idx" ON "activos_amortizables"("companyId");

-- CreateIndex
CREATE INDEX "activos_amortizables_structureId_idx" ON "activos_amortizables"("structureId");

-- CreateIndex
CREATE INDEX "desperdicio_registros_companyId_idx" ON "desperdicio_registros"("companyId");

-- CreateIndex
CREATE INDEX "desperdicio_registros_periodId_idx" ON "desperdicio_registros"("periodId");

-- AddForeignKey
ALTER TABLE "activos_amortizables" ADD CONSTRAINT "activos_amortizables_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activos_amortizables" ADD CONSTRAINT "activos_amortizables_structureId_fkey" FOREIGN KEY ("structureId") REFERENCES "cost_structures"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activos_amortizables" ADD CONSTRAINT "activos_amortizables_unidadId_fkey" FOREIGN KEY ("unidadId") REFERENCES "unidades_medida"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "desperdicio_registros" ADD CONSTRAINT "desperdicio_registros_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "desperdicio_registros" ADD CONSTRAINT "desperdicio_registros_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "cost_periods"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "desperdicio_registros" ADD CONSTRAINT "desperdicio_registros_unidadId_fkey" FOREIGN KEY ("unidadId") REFERENCES "unidades_medida"("id") ON DELETE SET NULL ON UPDATE CASCADE;
