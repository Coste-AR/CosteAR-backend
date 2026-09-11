import type { PrismaClient, VaultSourceType } from '@prisma/client';
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
  /** Namespace por origen. Si no se pasa, se deriva del `sourceFile`. */
  sourceType?: VaultSourceType | null;
  /** Contexto que F1-05 antepone al `content` antes de embeber. */
  contextualPrefix?: string | null;
}

/**
 * Deriva el namespace de un chunk a partir del primer segmento de su ruta.
 * Cubre tres formas de la bóveda:
 *  - el objetivo de F1-02 (`conocimiento/<ns>/…`),
 *  - la reorganización del 09/09/2026 (`001.1 - Teoría de Costos/…`, con
 *    `Costos I`, `Costos II` y la Ruta de Aprendizaje — todo metodología de
 *    cátedra),
 *  - la previa (`001.1 - Clases (Mirta)/…`, `costeo-procesos/…`).
 * Normaliza a NFC porque un checkout en macOS puede entregar el acento de
 * "Teoría" descompuesto y `startsWith` no lo matchearía.
 * Devuelve `null` si la carpeta no matchea ninguna conocida.
 */
export function deriveSourceType(sourceFile: string): VaultSourceType | null {
  const p = sourceFile.replace(/\\/g, '/').normalize('NFC');
  if (
    p.startsWith('conocimiento/catedra/') ||
    p.startsWith('001.1 - Clases') ||
    p.startsWith('001.1 - Teoría de Costos/')
  )
    return 'CATEDRA';
  if (p.startsWith('conocimiento/procesos/') || p.startsWith('costeo-procesos/')) return 'PROCESOS';
  if (p.startsWith('conocimiento/aprendizaje/')) return 'APRENDIZAJE';
  return null;
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
  /**
   * Vecinos por distancia coseno del embedding. Sin filtro de distancia: el
   * ranking lo resuelve el fusor (RRF). `namespaces` acota por `sourceType`.
   */
  searchByVector(
    queryEmbedding: number[],
    limit: number,
    namespaces?: VaultSourceType[],
  ): Promise<VaultSearchHit[]>;

  /**
   * Coincidencias por full-text en español (`contentTsv @@ websearch_to_tsquery`).
   * Ordenadas por `ts_rank_cd` desc. `namespaces` acota por `sourceType`.
   */
  searchByFullText(
    query: string,
    limit: number,
    namespaces?: VaultSourceType[],
  ): Promise<VaultSearchHit[]>;
}

export interface VaultSearchHit {
  id: string;
  sourceFile: string;
  sourceTitle: string;
  headingPath: string | null;
  content: string;
  sourceType: VaultSourceType | null;
  /** Distancia coseno (rama vector). `null` cuando el hit vino solo por full-text. */
  distance: number | null;
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
    const sourceType = input.sourceType ?? deriveSourceType(input.sourceFile);
    const contextualPrefix = input.contextualPrefix ?? null;
    await this.db.$executeRaw`
      INSERT INTO "vault_chunks"
        ("id", "sourceFile", "sourceTitle", "headingPath", "content", "contentHash", "chunkIndex", "vaultCommit", "sourceType", "contextualPrefix", "embedding", "createdAt", "updatedAt")
      VALUES
        (gen_random_uuid(), ${input.sourceFile}, ${input.sourceTitle}, ${input.headingPath}, ${input.content}, ${input.contentHash}, ${input.chunkIndex}, ${input.vaultCommit}, ${sourceType}::"VaultSourceType", ${contextualPrefix}, ${vectorLiteral}::vector, now(), now())
      ON CONFLICT ("sourceFile", "chunkIndex")
      DO UPDATE SET
        "sourceTitle" = EXCLUDED."sourceTitle",
        "headingPath" = EXCLUDED."headingPath",
        "content" = EXCLUDED."content",
        "contentHash" = EXCLUDED."contentHash",
        "vaultCommit" = EXCLUDED."vaultCommit",
        "sourceType" = EXCLUDED."sourceType",
        "contextualPrefix" = EXCLUDED."contextualPrefix",
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

  /**
   * La forma de la fila cruda. Los numéricos de Postgres pueden llegar como
   * texto según el driver — de ahí los `Number(...)` al mapear.
   */
  private mapHit(row: {
    id: string;
    sourceFile: string;
    sourceTitle: string;
    headingPath: string | null;
    content: string;
    sourceType: string | null;
    distance?: number | string | null;
  }): VaultSearchHit {
    return {
      id: row.id,
      sourceFile: row.sourceFile,
      sourceTitle: row.sourceTitle,
      headingPath: row.headingPath,
      content: row.content,
      sourceType: (row.sourceType as VaultSourceType | null) ?? null,
      distance: row.distance == null ? null : Number(row.distance),
    };
  }

  /** `sourceType IN (...)` como fragmento SQL + params posicionales, o vacío. */
  private namespaceClause(
    namespaces: VaultSourceType[] | undefined,
    startParam: number,
  ): { clause: string; params: string[] } {
    if (!namespaces || namespaces.length === 0) return { clause: '', params: [] };
    const placeholders = namespaces.map((_, i) => `$${startParam + i}`).join(', ');
    // `::text` para comparar el enum contra params de texto sin un cast por valor.
    return { clause: `AND "sourceType"::text IN (${placeholders})`, params: [...namespaces] };
  }

  async searchByVector(
    queryEmbedding: number[],
    limit: number,
    namespaces?: VaultSourceType[],
  ): Promise<VaultSearchHit[]> {
    const vectorLiteral = `[${queryEmbedding.join(',')}]`;
    const ns = this.namespaceClause(namespaces, 2);
    const rows = await this.db.$queryRawUnsafe<Parameters<typeof this.mapHit>[0][]>(
      `
      SELECT "id", "sourceFile", "sourceTitle", "headingPath", "content", "sourceType",
             ("embedding" <=> $1::vector) AS "distance"
      FROM "vault_chunks"
      WHERE "embedding" IS NOT NULL ${ns.clause}
      ORDER BY "embedding" <=> $1::vector ASC
      LIMIT $${2 + ns.params.length};
    `,
      vectorLiteral,
      ...ns.params,
      limit,
    );
    return rows.map((r) => this.mapHit(r));
  }

  async searchByFullText(
    query: string,
    limit: number,
    namespaces?: VaultSourceType[],
  ): Promise<VaultSearchHit[]> {
    const ns = this.namespaceClause(namespaces, 2);
    const rows = await this.db.$queryRawUnsafe<Parameters<typeof this.mapHit>[0][]>(
      `
      SELECT "id", "sourceFile", "sourceTitle", "headingPath", "content", "sourceType",
             NULL AS "distance"
      FROM "vault_chunks"
      WHERE "contentTsv" @@ websearch_to_tsquery('spanish', $1) ${ns.clause}
      ORDER BY ts_rank_cd("contentTsv", websearch_to_tsquery('spanish', $1)) DESC
      LIMIT $${2 + ns.params.length};
    `,
      query,
      ...ns.params,
      limit,
    );
    return rows.map((r) => this.mapHit(r));
  }
}
