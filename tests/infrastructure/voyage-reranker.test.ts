import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// getEnv valida el entorno completo; se controla acá.
const envValues = { VOYAGE_API_KEY: 'pa-clave-de-prueba-suficientemente-larga' };
vi.mock('@/infrastructure/config/env.js', () => ({ getEnv: () => envValues, resetEnvCache: () => {} }));

const { VoyageReranker } = await import('@/infrastructure/ai/voyage-reranker.js');

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  envValues.VOYAGE_API_KEY = 'pa-clave-de-prueba-suficientemente-larga';
});
afterEach(() => vi.unstubAllGlobals());

function ok(body: unknown) {
  return { ok: true, status: 200, headers: new Headers(), json: async () => body, text: async () => '' };
}

describe('VoyageReranker.rerank', () => {
  it('devuelve { index, score } ordenados por relevancia descendente', async () => {
    fetchMock.mockResolvedValue(
      ok({
        data: [
          { index: 0, relevance_score: 0.2 },
          { index: 1, relevance_score: 0.95 },
          { index: 2, relevance_score: 0.6 },
        ],
      }),
    );

    const out = await new VoyageReranker().rerank('q', ['a', 'b', 'c'], 2);

    expect(out).toEqual([
      { index: 1, score: 0.95 },
      { index: 2, score: 0.6 },
      { index: 0, score: 0.2 },
    ]);
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body).toMatchObject({ query: 'q', model: 'rerank-2.5', top_k: 2 });
  });

  it('null si no está configurado (sin llamar a la API)', async () => {
    envValues.VOYAGE_API_KEY = 'voyage_placeholder';
    const out = await new VoyageReranker().rerank('q', ['a'], 1);
    expect(out).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('null con lista de documentos vacía', async () => {
    const out = await new VoyageReranker().rerank('q', [], 5);
    expect(out).toBeNull();
  });

  it('null si la API responde error o el fetch falla (degradación segura)', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, headers: new Headers(), text: async () => 'boom' });
    expect(await new VoyageReranker().rerank('q', ['a'], 1)).toBeNull();

    fetchMock.mockRejectedValueOnce(new Error('network'));
    expect(await new VoyageReranker().rerank('q', ['a'], 1)).toBeNull();
  });
});
