import { describe, it, expect, vi } from 'vitest';
import { fuseRRF, VaultRetriever } from '@/application/vault-query/vault-retriever.js';
import type { VaultSearchHit } from '@/application/vault-indexer/vault-chunk-repository.js';

function hit(id: string, over: Partial<VaultSearchHit> = {}): VaultSearchHit {
  return {
    id,
    sourceFile: `${id}.md`,
    sourceTitle: id,
    headingPath: null,
    content: id,
    sourceType: null,
    distance: null,
    ...over,
  };
}

describe('fuseRRF', () => {
  it('un documento que aparece en las dos ramas gana sobre los que aparecen en una sola', () => {
    const vector = [hit('a', { distance: 0.1 }), hit('b', { distance: 0.2 })];
    const fts = [hit('c'), hit('a')];

    const fused = fuseRRF(vector, fts);

    expect(fused[0]!.id).toBe('a'); // en ambas listas
    expect(fused[0]!.vectorRank).toBe(1);
    expect(fused[0]!.ftsRank).toBe(2);
    expect(fused[0]!.distance).toBe(0.1); // conserva la distancia de la rama vector
  });

  it('conserva `distance` null cuando el hit vino solo por full-text', () => {
    const fused = fuseRRF([], [hit('x')]);
    expect(fused[0]!.distance).toBeNull();
    expect(fused[0]!.vectorRank).toBeNull();
    expect(fused[0]!.ftsRank).toBe(1);
  });

  it('el score RRF respeta k=60: 1/(60+rank) por lista', () => {
    const fused = fuseRRF([hit('a')], [hit('a')]);
    expect(fused[0]!.rrfScore).toBeCloseTo(1 / 61 + 1 / 61, 6);
  });
});

/** Reranker que no reordena (devuelve null → se conserva el orden por RRF). */
const noopReranker = { rerank: vi.fn().mockResolvedValue(null) };

describe('VaultRetriever.retrieve', () => {
  it('lanza si no se puede generar el embedding', async () => {
    const embedder = { embed: vi.fn().mockResolvedValue(null) };
    const repo = { searchByVector: vi.fn(), searchByFullText: vi.fn() };
    const r = new VaultRetriever(embedder as never, repo as never, noopReranker as never);
    await expect(r.retrieve('hola')).rejects.toThrow(/embedding/i);
  });

  it('consulta las dos ramas con 20 candidatos; sin reranker conserva el orden por RRF', async () => {
    const embedder = { embed: vi.fn().mockResolvedValue([[0.1, 0.2]]) };
    const repo = {
      searchByVector: vi.fn().mockResolvedValue([hit('a', { distance: 0.1 }), hit('b', { distance: 0.3 })]),
      searchByFullText: vi.fn().mockResolvedValue([hit('c'), hit('a')]),
    };
    const r = new VaultRetriever(embedder as never, repo as never, noopReranker as never);

    const out = await r.retrieve('flete materia prima', { limit: 2, namespaces: ['CATEDRA'] });

    expect(repo.searchByVector).toHaveBeenCalledWith([0.1, 0.2], 20, ['CATEDRA']);
    expect(repo.searchByFullText).toHaveBeenCalledWith('flete materia prima', 20, ['CATEDRA']);
    expect(out).toHaveLength(2);
    expect(out[0]!.id).toBe('a');
    expect(out[0]!.rerankScore).toBeNull();
  });

  it('con reranker: reordena los candidatos por el score y trunca a `limit`', async () => {
    const embedder = { embed: vi.fn().mockResolvedValue([[0.1]]) };
    const repo = {
      // orden por RRF: a, b, c
      searchByVector: vi.fn().mockResolvedValue([hit('a'), hit('b'), hit('c')]),
      searchByFullText: vi.fn().mockResolvedValue([]),
    };
    // el reranker dice que el mejor es el índice 2 (c), después el 0 (a)
    const reranker = {
      rerank: vi.fn().mockResolvedValue([
        { index: 2, score: 0.91 },
        { index: 0, score: 0.4 },
      ]),
    };
    const r = new VaultRetriever(embedder as never, repo as never, reranker as never);

    const out = await r.retrieve('pregunta', { limit: 2 });

    expect(reranker.rerank).toHaveBeenCalledWith('pregunta', ['a', 'b', 'c'], 2);
    expect(out.map((c) => c.id)).toEqual(['c', 'a']);
    expect(out[0]!.rerankScore).toBe(0.91);
  });
});
