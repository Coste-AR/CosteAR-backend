-- CreateTable
CREATE TABLE "industry_profiles" (
    "id" UUID NOT NULL,
    "category" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "mpKeywords" TEXT[],
    "cipKeywords" TEXT[],
    "modKeywords" TEXT[],
    "eventKeywords" TEXT[],
    "lossKeywords" TEXT[],
    "energyIsMP" BOOLEAN NOT NULL DEFAULT false,
    "fuelIsMP" BOOLEAN NOT NULL DEFAULT false,
    "detectPatterns" TEXT[],
    "measurementUnit" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "industry_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "industry_profiles_category_key" ON "industry_profiles"("category");
