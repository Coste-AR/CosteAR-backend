-- CreateEnum
CREATE TYPE "CostingSystem" AS ENUM ('ORDERS', 'PROCESSES');

-- AlterTable
ALTER TABLE "cost_structures" ADD COLUMN "costingSystem" "CostingSystem" NOT NULL DEFAULT 'ORDERS';
