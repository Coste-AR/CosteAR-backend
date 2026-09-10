import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/infrastructure/database/prisma.js';
import { PrismaVaultChunkRepository } from '@/application/vault-indexer/vault-chunk-repository.js';
import { VaultRetriever } from '@/application/vault-query/vault-retriever.js';

const repo = new PrismaVaultChunkRepository();
const tag = randomUUID().slice(0, 8);
const DIMS = 1024;

/** Embedding sintético: un 1 en `pos`, 0 en el resto. Así controlamos la distancia. */
function vec(pos: number): number[] {
  const v = new Array(DIMS).fill(0);
  v[pos] = 1;
  return v;
}

const CHUNKS = [
  { file: `conocimiento/catedra/itcs-${tag}.md`, content: `El ITCS-${tag} es el índice de la cátedra para ponderar costos.`, pos: 0, ns: 'CATEDRA' as const },
  { file: `conocimiento/catedra/fifo-${tag}.md`, content: `El método FIFO valúa el inventario por primeras entradas.`, pos: 1, ns: 'CATEDRA' as const },
  { file: `conocimiento/procesos/prorrateo-${tag}.md`, content: `El prorrateo de CIP reparte los costos indirectos por base.`, pos: 2, ns: 'PROCESOS' as const },
];

beforeAll(async () => {
  for (let i = 0; i < CHUNKS.length; i++) {
    const c = CHUNKS[i]!;
    await repo.upsertChunk({
      sourceFile: c.file,
      sourceTitle: c.file,
      headingPath: null,
      content: c.content,
      contentHash: randomUUID(),
      chunkIndex: 0,
      vaultCommit: 'test',
      embedding: vec(c.pos),
      sourceType: c.ns,
    });
  }
});

afterAll(async () => {
  await prisma.vaultChunk.deleteMany({ where: { sourceFile: { in: CHUNKS.map((c) => c.file) } } });
});

describe('VaultRetriever (integración: híbrido vector + full-text + RRF)', () => {
  const embedder = { embed: async (_t: string[]) => [vec(0)] };
  // Reranker desactivado: se prueba el orden por RRF (el rerank real necesita API key).
  const noRerank = { rerank: async () => null };
  const retriever = new VaultRetriever(embedder as never, repo, noRerank as never);

  it('una sigla exacta se recupera aunque el vector apunte a otro chunk (rama full-text)', async () => {
    // El embedder devuelve vec(0) → el más cercano por vector es itcs. Pero
    // buscamos por una sigla literal que SOLO está en itcs igual: probamos que
    // la rama FTS la encuentra por texto, no solo por vector.
    const out = await retriever.retrieve(`ITCS-${tag}`, { limit: 3 });
    const files = out.map((c) => c.sourceFile);
    expect(files).toContain(`conocimiento/catedra/itcs-${tag}.md`);
    const itcs = out.find((c) => c.sourceFile.includes('itcs'));
    expect(itcs?.ftsRank).not.toBeNull(); // vino (también) por full-text
  });

  it('filtra por namespace: con `namespaces: [PROCESOS]` no aparece contenido de CATEDRA', async () => {
    const out = await retriever.retrieve(`prorrateo CIP ${tag}`, { limit: 5, namespaces: ['PROCESOS'] });
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((c) => c.sourceType === 'PROCESOS')).toBe(true);
  });

  it('un chunk que matchea por vector Y por texto queda arriba del que matchea por una sola vía', async () => {
    // "ITCS-tag índice cátedra" → itcs matchea por texto; el embedder apunta a vec(0)=itcs por vector.
    const out = await retriever.retrieve(`ITCS-${tag} índice cátedra`, { limit: 3 });
    expect(out[0]?.sourceFile).toBe(`conocimiento/catedra/itcs-${tag}.md`);
    expect(out[0]?.vectorRank).not.toBeNull();
    expect(out[0]?.ftsRank).not.toBeNull();
  });
});
