/*
  Warnings:

  - You are about to drop the column `operatorConnectionId` on the `users` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "InviteStatus" AS ENUM ('PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED');

-- DropForeignKey
ALTER TABLE "users" DROP CONSTRAINT "users_operatorConnectionId_fkey";

-- AlterTable
ALTER TABLE "users" DROP COLUMN "operatorConnectionId";

-- CreateTable
CREATE TABLE "operator_memberships" (
    "id" UUID NOT NULL,
    "operatorId" UUID NOT NULL,
    "connectionId" UUID NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "operator_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operator_invites" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "connectionId" UUID NOT NULL,
    "costistId" UUID NOT NULL,
    "inviteeEmail" TEXT NOT NULL,
    "inviteeId" UUID,
    "status" "InviteStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "operator_invites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "operator_memberships_operatorId_idx" ON "operator_memberships"("operatorId");

-- CreateIndex
CREATE INDEX "operator_memberships_connectionId_idx" ON "operator_memberships"("connectionId");

-- CreateIndex
CREATE UNIQUE INDEX "operator_memberships_operatorId_connectionId_key" ON "operator_memberships"("operatorId", "connectionId");

-- CreateIndex
CREATE UNIQUE INDEX "operator_invites_code_key" ON "operator_invites"("code");

-- CreateIndex
CREATE INDEX "operator_invites_code_idx" ON "operator_invites"("code");

-- CreateIndex
CREATE INDEX "operator_invites_connectionId_idx" ON "operator_invites"("connectionId");

-- CreateIndex
CREATE INDEX "operator_invites_inviteeEmail_idx" ON "operator_invites"("inviteeEmail");

-- AddForeignKey
ALTER TABLE "operator_memberships" ADD CONSTRAINT "operator_memberships_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operator_memberships" ADD CONSTRAINT "operator_memberships_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "empresa_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operator_invites" ADD CONSTRAINT "operator_invites_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "empresa_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operator_invites" ADD CONSTRAINT "operator_invites_costistId_fkey" FOREIGN KEY ("costistId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operator_invites" ADD CONSTRAINT "operator_invites_inviteeId_fkey" FOREIGN KEY ("inviteeId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
