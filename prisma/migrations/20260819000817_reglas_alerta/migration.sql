-- Reglas de alerta por indicador fisico (S-05b).
--
-- ADITIVA (DOM-06). Se filtraron las sentencias destructivas que Prisma agrega
-- por la deriva preexistente del schema (ver issue #72).
--
-- OJO CON EL NOMBRE DE LA CARPETA: generado con `date -u`, en UTC, igual que lo
-- hace Prisma. Mezclar hora local con UTC ya rompio una migracion antes: la
-- dependiente quedo primero y fallo en base limpia.

-- CreateEnum
CREATE TYPE "CondicionAlerta" AS ENUM ('MAYOR', 'MENOR', 'FUERA_DE_RANGO_PCT');

-- CreateEnum
CREATE TYPE "SeveridadAlerta" AS ENUM ('INFO', 'ADVERTENCIA', 'CRITICA');

-- CreateEnum
CREATE TYPE "CanalAlerta" AS ENUM ('IN_APP', 'EMAIL');

-- AlterEnum
ALTER TYPE "AlertType" ADD VALUE 'INDICADOR_FISICO';

-- CreateTable
CREATE TABLE "reglas_alerta" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "structureId" UUID,
    "indicador" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,
    "condicion" "CondicionAlerta" NOT NULL,
    "umbral" DECIMAL(18,6) NOT NULL,
    "unidadId" UUID,
    "lecturasSostenidas" INTEGER NOT NULL DEFAULT 1,
    "severidad" "SeveridadAlerta" NOT NULL DEFAULT 'ADVERTENCIA',
    "destinatarios" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "canal" "CanalAlerta" NOT NULL DEFAULT 'IN_APP',
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "deletedAt" TIMESTAMPTZ,

    CONSTRAINT "reglas_alerta_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reglas_alerta_companyId_activa_idx" ON "reglas_alerta"("companyId", "activa");

-- CreateIndex
CREATE UNIQUE INDEX "reglas_alerta_companyId_structureId_indicador_key" ON "reglas_alerta"("companyId", "structureId", "indicador");

-- AddForeignKey
ALTER TABLE "reglas_alerta" ADD CONSTRAINT "reglas_alerta_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reglas_alerta" ADD CONSTRAINT "reglas_alerta_structureId_fkey" FOREIGN KEY ("structureId") REFERENCES "cost_structures"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reglas_alerta" ADD CONSTRAINT "reglas_alerta_unidadId_fkey" FOREIGN KEY ("unidadId") REFERENCES "unidades_medida"("id") ON DELETE SET NULL ON UPDATE CASCADE;
