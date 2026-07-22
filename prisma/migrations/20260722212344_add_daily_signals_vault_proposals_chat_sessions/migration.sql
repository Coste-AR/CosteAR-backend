-- CreateEnum
CREATE TYPE "DailySignalType" AS ENUM ('RAG_MISS', 'USER_CORRECTION', 'IMPROVEMENT_REPORT');

-- CreateEnum
CREATE TYPE "DailySignalStatus" AS ENUM ('PENDING', 'PROCESSED', 'REJECTED');

-- CreateEnum
CREATE TYPE "VaultChatRole" AS ENUM ('USER', 'ASSISTANT');

-- CreateTable
CREATE TABLE "daily_signals" (
    "id" UUID NOT NULL,
    "type" "DailySignalType" NOT NULL,
    "status" "DailySignalStatus" NOT NULL DEFAULT 'PENDING',
    "content" TEXT NOT NULL,
    "context" JSONB,
    "userId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_signals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vault_edit_proposals" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "sourceFile" TEXT NOT NULL,
    "proposedText" TEXT NOT NULL,
    "justification" TEXT NOT NULL,
    "status" "DailySignalStatus" NOT NULL DEFAULT 'PENDING',
    "signalsUsed" UUID[],
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vault_edit_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vault_chat_sessions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'Nueva conversación',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vault_chat_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vault_chat_messages" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "role" "VaultChatRole" NOT NULL,
    "content" TEXT NOT NULL,
    "citations" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "confidence" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vault_chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "daily_signals_status_idx" ON "daily_signals"("status");

-- CreateIndex
CREATE INDEX "vault_edit_proposals_status_idx" ON "vault_edit_proposals"("status");

-- CreateIndex
CREATE INDEX "vault_chat_sessions_userId_idx" ON "vault_chat_sessions"("userId");

-- CreateIndex
CREATE INDEX "vault_chat_messages_sessionId_idx" ON "vault_chat_messages"("sessionId");

-- AddForeignKey
ALTER TABLE "daily_signals" ADD CONSTRAINT "daily_signals_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vault_chat_sessions" ADD CONSTRAINT "vault_chat_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vault_chat_messages" ADD CONSTRAINT "vault_chat_messages_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "vault_chat_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
