import type { PrismaClient } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma.js';

export interface VaultChunkIdentity {
  chunkIndex: number;
  contentHash: string;
}

export interface UpsertChunkInput {
  sourceFile: string;
  sourceTitle: string;
  headingPath: string | null;
  content: string;
  contentHash: string;
  chunkIndex: number;
  vaultCommit: string;
  embedding: number[];
}

export interface VaultChunkRepository {
  listBySourceFile(sourceFile: string): Promise<VaultChunkIdentity[]>;
  upsertChunk(input: UpsertChunkInput): Promise<void>;
  /** Borra los chunks de `sourceFile` cuyo chunkIndex sea mayor a `keepUpTo`
   *  (la nota se achicó). Pasar -1 borra todos los chunks de ese archivo. */
  deleteChunksBeyondIndex(sourceFile: string, keepUpTo: number): Promise<void>;
  /** Borra todo chunk cuyo sourceFile NO esté en `currentSourceFiles`
   *  (notas eliminadas/renombradas). Devuelve cuántos borró. */
  deleteOrphanChunks(currentSourceFiles: string[]): Promise<number>;
}

export class PrismaVaultChunkRepository implements VaultChunkRepository {
  constructor(private readonly db: PrismaClient = prisma) {}

  async listBySourceFile(sourceFile: string): Promise<VaultChunkIdentity[]> {
    return this.db.vaultChunk.findMany({
      where: { sourceFile },
      select: { chunkIndex: true, contentHash: true },
    });
  }

  async upsertChunk(input: UpsertChunkInput): Promise<void> {
    const vectorLiteral = `[${input.embedding.join(',')}]`;
    await this.db.$executeRaw`
      INSERT INTO "vault_chunks"
        ("id", "sourceFile", "sourceTitle", "headingPath", "content", "contentHash", "chunkIndex", "vaultCommit", "embedding", "createdAt", "updatedAt")
      VALUES
        (gen_random_uuid(), ${input.sourceFile}, ${input.sourceTitle}, ${input.headingPath}, ${input.content}, ${input.contentHash}, ${input.chunkIndex}, ${input.vaultCommit}, ${vectorLiteral}::vector, now(), now())
      ON CONFLICT ("sourceFile", "chunkIndex")
      DO UPDATE SET
        "sourceTitle" = EXCLUDED."sourceTitle",
        "headingPath" = EXCLUDED."headingPath",
        "content" = EXCLUDED."content",
        "contentHash" = EXCLUDED."contentHash",
        "vaultCommit" = EXCLUDED."vaultCommit",
        "embedding" = EXCLUDED."embedding",
        "updatedAt" = now()
    `;
  }

  async deleteChunksBeyondIndex(sourceFile: string, keepUpTo: number): Promise<void> {
    await this.db.vaultChunk.deleteMany({
      where: { sourceFile, chunkIndex: { gt: keepUpTo } },
    });
  }

  async deleteOrphanChunks(currentSourceFiles: string[]): Promise<number> {
    if (currentSourceFiles.length === 0) {
      const result = await this.db.vaultChunk.deleteMany({});
      return result.count;
    }
    const result = await this.db.vaultChunk.deleteMany({
      where: { sourceFile: { notIn: currentSourceFiles } },
    });
    return result.count;
  }
}
