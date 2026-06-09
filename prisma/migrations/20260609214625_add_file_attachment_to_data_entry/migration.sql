-- DropIndex
DROP INDEX "users_operatorConnectionId_idx";

-- AlterTable
ALTER TABLE "data_entries" ADD COLUMN     "fileData" TEXT,
ADD COLUMN     "fileMimeType" TEXT,
ADD COLUMN     "fileName" TEXT,
ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "empresa_connections" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "apiKey" DROP DEFAULT,
ALTER COLUMN "apiKey" SET DATA TYPE TEXT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "validation_history" ALTER COLUMN "id" DROP DEFAULT;
