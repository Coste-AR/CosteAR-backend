-- Canal Telegram (A-19). La asociación vive en la membresía: un chat queda
-- ligado a una persona y, por esa membresía, a una única conexión/empresa.

ALTER TABLE "operator_memberships"
  ADD COLUMN "telegramChatId" TEXT;

CREATE UNIQUE INDEX "operator_memberships_telegramChatId_key"
  ON "operator_memberships"("telegramChatId");

ALTER TYPE "DataEntrySourceType" ADD VALUE 'TELEGRAM';
