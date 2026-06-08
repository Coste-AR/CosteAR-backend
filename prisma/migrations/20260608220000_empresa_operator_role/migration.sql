-- AlterEnum: agregar EMPRESA_OPERATOR al enum UserRole
ALTER TYPE "UserRole" ADD VALUE 'EMPRESA_OPERATOR';

-- AlterTable: agregar operatorConnectionId a users
ALTER TABLE "users" ADD COLUMN "operatorConnectionId" UUID;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_operatorConnectionId_fkey"
    FOREIGN KEY ("operatorConnectionId") REFERENCES "empresa_connections"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "users_operatorConnectionId_idx" ON "users"("operatorConnectionId");
