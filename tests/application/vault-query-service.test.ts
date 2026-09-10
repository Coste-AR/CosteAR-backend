import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDb = {
  dailySignal: { create: vi.fn() },
  vaultQueryLog: { create: vi.fn().mockResolvedValue({ id: 'log-1' }) },
};
vi.mock('@/infrastructure/database/prisma.js', () => ({ prisma: mockDb }));

const mockRetriever = { retrieve: vi.fn() };
const mockAi = { isConfigured: true, modelId: 'claude-sonnet-4-5', completeJSON: vi.fn() };

/** Un `RetrievedChunk` con defaults; `distance` bajo = match semántico directo. */
function chunk(over: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    sourceFile: 'Costeo/ITCS.md',
    sourceTitle: 'ITCS',
    headingPath: 'ITCS > Definición',
    content: 'El ITCS es la Tasa Integral de Costo Social...',
    sourceType: 'CATEDRA',
    vectorRank: 1,
    ftsRank: null,
    distance: 0.12,
    rrfScore: 0.9,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAi.isConfigured = true;
  mockDb.vaultQueryLog.create.mockResolvedValue({ id: 'log-1' });
});

async function service() {
  const { VaultQueryService } = await import('@/application/vault-query/vault-query-service.js');
  return new VaultQueryService(mockRetriever as never, mockAi as never);
}

describe('VaultQueryService.query', () => {
  it('confianza HIGH con match semántico directo y el LLM contesta desde el contexto', async () => {
    mockRetriever.retrieve.mockResolvedValue([chunk()]);
    mockAi.completeJSON.mockResolvedValue({
      answer: 'El ITCS es la Tasa Integral de Costo Social.',
      citations: ['Costeo/ITCS.md'],
      answeredFromContext: true,
    });

    const res = await (await service()).query('¿Qué es el ITCS?');

    expect(res.confidence).toBe('HIGH');
    expect(res.answer).toBe('El ITCS es la Tasa Integral de Costo Social.');
    expect(res.citations).toEqual(['Costeo/ITCS.md']);
    expect(mockRetriever.retrieve).toHaveBeenCalledWith('¿Qué es el ITCS?', { limit: 5 });
  });

  it('filtra citas alucinadas: un archivo que no estaba en el contexto se descarta', async () => {
    mockRetriever.retrieve.mockResolvedValue([chunk()]);
    mockAi.completeJSON.mockResolvedValue({
      answer: 'El ITCS es...',
      citations: ['Costeo/ITCS.md', 'Costeo/Archivo-Inventado.md'],
      answeredFromContext: true,
    });

    const res = await (await service()).query('¿Qué es el ITCS?');
    expect(res.citations).toEqual(['Costeo/ITCS.md']);
  });

  it('confianza LOW si ningún chunk tuvo match semántico directo (solo full-text / vecinos lejanos)', async () => {
    mockRetriever.retrieve.mockResolvedValue([
      chunk({ distance: null, vectorRank: null, ftsRank: 1 }),
      chunk({ id: 'c2', distance: 0.78 }),
    ]);
    mockAi.completeJSON.mockResolvedValue({
      answer: 'El ITCS es...',
      citations: ['Costeo/ITCS.md'],
      answeredFromContext: true,
    });

    const res = await (await service()).query('ITCS');
    expect(res.confidence).toBe('LOW');
  });

  it('sin chunks: negativa, confianza NONE y registra RAG_MISS', async () => {
    mockRetriever.retrieve.mockResolvedValue([]);

    const res = await (await service()).query('pregunta sin relación con costeo');

    expect(res.confidence).toBe('NONE');
    expect(res.citations).toEqual([]);
    expect(mockAi.completeJSON).not.toHaveBeenCalled();
    expect(mockDb.dailySignal.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: 'RAG_MISS', source: 'COSTISTA_CHAT' }),
      }),
    );
  });

  it('si el LLM se niega (answeredFromContext=false): LOW, sin citas y registra RAG_MISS', async () => {
    mockRetriever.retrieve.mockResolvedValue([chunk()]);
    mockAi.completeJSON.mockResolvedValue({
      answer: 'No tengo información suficiente en la bóveda para responder eso.',
      citations: [],
      answeredFromContext: false,
    });

    const res = await (await service()).query('¿Cuál es el mejor color para el logo?');

    expect(res.confidence).toBe('LOW');
    expect(res.citations).toEqual([]);
    expect(mockDb.dailySignal.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'RAG_MISS',
          context: { reason: 'LLM generated refusal (answeredFromContext=false)' },
        }),
      }),
    );
  });

  it('lanza UnprocessableEntityError si el LLM no está configurado', async () => {
    mockAi.isConfigured = false;
    await expect((await service()).query('¿Qué es el ITCS?')).rejects.toThrow(/no está configurado/);
  });

  it('capa el contexto a MAX_CONTEXT_CHARS antes de armar el prompt del LLM', async () => {
    const huge = chunk({ content: 'x'.repeat(20_000) });
    mockRetriever.retrieve.mockResolvedValue([huge, { ...huge, id: 'c2' }, { ...huge, id: 'c3' }]);
    mockAi.completeJSON.mockResolvedValue({ answer: 'ok', citations: [], answeredFromContext: true });

    await (await service()).query('pregunta con contexto enorme');

    const [, userPrompt] = mockAi.completeJSON.mock.calls[0] as [string, string];
    const contextPart = userPrompt.split('CONTEXTO:\n')[1] ?? '';
    expect(contextPart.length).toBeLessThanOrEqual(12_000 + 200);
  });

  it('registra en vault_query_log el rrfScore y la distancia de cada chunk', async () => {
    mockRetriever.retrieve.mockResolvedValue([chunk({ rrfScore: 0.42, distance: 0.2 })]);
    mockAi.completeJSON.mockResolvedValue({ answer: 'ok', citations: [], answeredFromContext: true });

    await (await service()).query('¿Qué es el ITCS?', { userId: null });

    const logged = mockDb.vaultQueryLog.create.mock.calls[0]![0].data;
    expect(logged.retrieverVersion).toBe('v2-hybrid-rrf');
    expect(logged.chunksReturned[0]).toMatchObject({
      sourceFile: 'Costeo/ITCS.md',
      rrfScore: 0.42,
      distance: 0.2,
    });
  });
});
