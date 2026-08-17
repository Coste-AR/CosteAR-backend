-- CreateTable
CREATE TABLE "vocabulario_terminos" (
    "id" UUID NOT NULL,
    "externalId" TEXT,
    "industryCategory" TEXT NOT NULL,
    "termino" TEXT NOT NULL,
    "variantes" TEXT[],
    "concepto" TEXT NOT NULL,
    "entidadDominio" TEXT NOT NULL,
    "seccion" TEXT NOT NULL,
    "yaEnPerfil" BOOLEAN NOT NULL DEFAULT false,
    "ambiguo" BOOLEAN NOT NULL DEFAULT false,
    "desambiguacion" TEXT,
    "cita" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vocabulario_terminos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vocabulario_terminos_industryCategory_idx" ON "vocabulario_terminos"("industryCategory");

-- CreateIndex
CREATE UNIQUE INDEX "vocabulario_terminos_industryCategory_termino_key" ON "vocabulario_terminos"("industryCategory", "termino");
