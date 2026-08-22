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
  /** Cuántos archivos DISTINTOS tienen al menos un chunk indexado hoy. */
  countDistinctSourceFiles(): Promise<number>;
  upsertChunk(input: UpsertChunkInput): Promise<void>;
  /** Borra los chunks de `sourceFile` cuyo chunkIndex sea mayor a `keepUpTo`
   *  (la nota se achicó). Pasar -1 borra todos los chunks de ese archivo.
   *  Devuelve cuántos borró. */
  deleteChunksBeyondIndex(sourceFile: string, keepUpTo: number): Promise<number>;
  /** Borra todo chunk cuyo sourceFile NO esté en `currentSourceFiles`
   *  (notas eliminadas/renombradas). Devuelve cuántos borró. */
  deleteOrphanChunks(currentSourceFiles: string[]): Promise<number>;
  /** Busca los chunks más similares semánticamente al embedding provisto usando distancia coseno. */
  searchChunks(queryEmbedding: number[], limit?: number, maxDistance?: number): Promise<Array<{
    id: string;
    sourceFile: string;
    sourceTitle: string;
    headingPath: string | null;
    content: string;
    distance: number;
  }>>;
}

export class PrismaVaultChunkRepository implements VaultChunkRepository {
  constructor(private readonly db: PrismaClient = prisma) {}

  async listBySourceFile(sourceFile: string): Promise<VaultChunkIdentity[]> {
    return this.db.vaultChunk.findMany({
      where: { sourceFile },
      select: { chunkIndex: true, contentHash: true },
    });
  }

  async countDistinctSourceFiles(): Promise<number> {
    const rows = await this.db.vaultChunk.findMany({
      distinct: ['sourceFile'],
      select: { sourceFile: true },
    });
    return rows.length;
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

  async deleteChunksBeyondIndex(sourceFile: string, keepUpTo: number): Promise<number> {
    const result = await this.db.vaultChunk.deleteMany({
      where: { sourceFile, chunkIndex: { gt: keepUpTo } },
    });
    return result.count;
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

  async searchChunks(queryEmbedding: number[], limit = 5, maxDistance = 0.35): Promise<Array<{
    id: string;
    sourceFile: string;
    sourceTitle: string;
    headingPath: string | null;
    content: string;
    distance: number;
  }>> {
    const vectorLiteral = `[${queryEmbedding.join(',')}]`;
    
    // Usamos el operador <=> para distancia coseno en pgvector
    /**
     * La forma de la fila cruda. `distance` se declara `number | string`
     * porque el driver puede devolver el numérico de Postgres como texto —
     * de ahí el `Number(...)` de más abajo, que ya estaba y ahora se explica.
     */
    type FilaVecina = {
      id: string;
      sourceFile: string;
      sourceTitle: string;
      headingPath: string | null;
      content: string;
      distance: number | string;
    };

    const result = await this.db.$queryRawUnsafe<FilaVecina[]>(`
      SELECT 
        "id", 
        "sourceFile", 
        "sourceTitle", 
        "headingPath", 
        "content",
        ("embedding" <=> $1::vector) as "distance"
      FROM "vault_chunks"
      WHERE ("embedding" <=> $1::vector) < $2
      ORDER BY "embedding" <=> $1::vector ASC
      LIMIT $3;
    `, vectorLiteral, maxDistance, limit);

    return result.map(row => ({
      id: row.id,
      sourceFile: row.sourceFile,
      sourceTitle: row.sourceTitle,
      headingPath: row.headingPath,
      content: row.content,
      distance: Number(row.distance)
    }));
  }
}
