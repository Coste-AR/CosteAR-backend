-- CreateEnum
CREATE TYPE "ProfessionalType" AS ENUM ('CONTADOR_PUBLICO', 'LIC_ADMINISTRACION', 'CONSULTOR_INDEPENDIENTE', 'ANALISTA_INTERNO', 'OTRO');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "cuit" TEXT,
ADD COLUMN     "dni" TEXT,
ADD COLUMN     "licenseNumber" TEXT,
ADD COLUMN     "onboardedAt" TIMESTAMP(3),
ADD COLUMN     "professionalType" "ProfessionalType",
ADD COLUMN     "province" TEXT;
