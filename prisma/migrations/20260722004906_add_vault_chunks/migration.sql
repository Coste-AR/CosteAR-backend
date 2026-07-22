CREATE EXTENSION IF NOT EXISTS vector;

-- CreateTable
CREATE TABLE "vault_chunks" (
    "id" UUID NOT NULL,
    "sourceFile" TEXT NOT NULL,
    "sourceTitle" TEXT NOT NULL,
    "headingPath" TEXT,
    "content" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "vaultCommit" TEXT NOT NULL,
    "embedding" vector(1024),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vault_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vault_chunks_sourceFile_chunkIndex_key" ON "vault_chunks"("sourceFile", "chunkIndex");

CREATE INDEX "vault_chunks_embedding_idx" ON "vault_chunks" USING hnsw ("embedding" vector_cosine_ops);
