import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDb = { dailySignal: { create: vi.fn() } };
vi.mock('@/infrastructure/database/prisma.js', () => ({ prisma: mockDb }));

const mockEmbedder = { isConfigured: true, embed: vi.fn() };
const mockAi = { isConfigured: true, completeJSON: vi.fn() };
const mockRepo = { searchChunks: vi.fn() };

const CHUNK = {
  sourceFile: 'Costeo/ITCS.md',
  headingPath: 'ITCS > Definición',
  content: 'El ITCS es la Tasa Integral de Costo Social...',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockEmbedder.isConfigured = true;
  mockAi.isConfigured = true;
  mockEmbedder.embed.mockResolvedValue([[0.1, 0.2, 0.3]]);
});

describe('VaultQueryService.query', () => {
  it('responde con confianza HIGH cuando hay match directo (umbral 0.65) y el LLM contesta desde el contexto', async () => {
    const { VaultQueryService } = await import('@/application/vault-query/vault-query-service.js');
    mockRepo.searchChunks.mockResolvedValueOnce([CHUNK]);
    mockAi.completeJSON.mockResolvedValue({
      answer: 'El ITCS es la Tasa Integral de Costo Social.',
      citations: ['Costeo/ITCS.md'],
      answeredFromContext: true,
    });

    const svc = new VaultQueryService(mockEmbedder as never, mockAi as never, mockRepo as never);
    const res = await svc.query('¿Qué es el ITCS?');

    expect(res.confidence).toBe('HIGH');
    expect(res.answer).toBe('El ITCS es la Tasa Integral de Costo Social.');
    expect(res.citations).toEqual(['Costeo/ITCS.md']);
    expect(mockRepo.searchChunks).toHaveBeenCalledTimes(1);
    expect(mockRepo.searchChunks).toHaveBeenCalledWith([0.1, 0.2, 0.3], 5, 0.65);
  });

  it('filtra citas alucinadas: si el LLM cita un archivo que no estaba en el contexto, se descarta', async () => {
    const { VaultQueryService } = await import('@/application/vault-query/vault-query-service.js');
    mockRepo.searchChunks.mockResolvedValueOnce([CHUNK]);
    mockAi.completeJSON.mockResolvedValue({
      answer: 'El ITCS es...',
      citations: ['Costeo/ITCS.md', 'Costeo/Archivo-Inventado.md'],
      answeredFromContext: true,
    });

    const svc = new VaultQueryService(mockEmbedder as never, mockAi as never, mockRepo as never);
    const res = await svc.query('¿Qué es el ITCS?');

    expect(res.citations).toEqual(['Costeo/ITCS.md']);
  });

  it('reintenta con umbral ampliado (0.85) si no hay match directo, y marca confianza LOW', async () => {
    const { VaultQueryService } = await import('@/application/vault-query/vault-query-service.js');
    mockRepo.searchChunks
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([CHUNK]);
    mockAi.completeJSON.mockResolvedValue({
      answer: 'El ITCS es...',
      citations: ['Costeo/ITCS.md'],
      answeredFromContext: true,
    });

    const svc = new VaultQueryService(mockEmbedder as never, mockAi as never, mockRepo as never);
    const res = await svc.query('ITCS');

    expect(mockRepo.searchChunks).toHaveBeenCalledTimes(2);
    expect(mockRepo.searchChunks).toHaveBeenNthCalledWith(2, [0.1, 0.2, 0.3], 5, 0.85);
    expect(res.confidence).toBe('LOW');
  });

  it('sin chunks en ningún umbral: responde negativa, confianza NONE, y registra RAG_MISS', async () => {
    const { VaultQueryService } = await import('@/application/vault-query/vault-query-service.js');
    mockRepo.searchChunks.mockResolvedValue([]);

    const svc = new VaultQueryService(mockEmbedder as never, mockAi as never, mockRepo as never);
    const res = await svc.query('pregunta sin relación con costeo');

    expect(res.confidence).toBe('NONE');
    expect(res.citations).toEqual([]);
    expect(mockAi.completeJSON).not.toHaveBeenCalled();
    expect(mockDb.dailySignal.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: 'RAG_MISS', source: 'COSTISTA_CHAT' }),
      }),
    );
  });

  it('si el LLM se niega (answeredFromContext=false), confianza LOW, sin citas, y registra RAG_MISS', async () => {
    const { VaultQueryService } = await import('@/application/vault-query/vault-query-service.js');
    mockRepo.searchChunks.mockResolvedValueOnce([CHUNK]);
    mockAi.completeJSON.mockResolvedValue({
      answer: 'No tengo información suficiente en la bóveda para responder eso.',
      citations: [],
      answeredFromContext: false,
    });

    const svc = new VaultQueryService(mockEmbedder as never, mockAi as never, mockRepo as never);
    const res = await svc.query('¿Cuál es el mejor color para el logo?');

    expect(res.confidence).toBe('LOW');
    expect(res.citations).toEqual([]);
    expect(mockDb.dailySignal.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: 'RAG_MISS', context: { reason: 'LLM generated refusal (answeredFromContext=false)' } }),
      }),
    );
  });

  it('lanza UnprocessableEntityError si Voyage o Groq no están configurados', async () => {
    const { VaultQueryService } = await import('@/application/vault-query/vault-query-service.js');
    mockEmbedder.isConfigured = false;

    const svc = new VaultQueryService(mockEmbedder as never, mockAi as never, mockRepo as never);
    await expect(svc.query('¿Qué es el ITCS?')).rejects.toThrow(/no está configurado/);
  });

  it('capa el contexto a MAX_CONTEXT_CHARS antes de armar el prompt del LLM', async () => {
    const { VaultQueryService } = await import('@/application/vault-query/vault-query-service.js');
    const hugeChunk = { ...CHUNK, content: 'x'.repeat(20_000) };
    mockRepo.searchChunks.mockResolvedValueOnce([hugeChunk, hugeChunk, hugeChunk]);
    mockAi.completeJSON.mockResolvedValue({
      answer: 'ok',
      citations: [],
      answeredFromContext: true,
    });

    const svc = new VaultQueryService(mockEmbedder as never, mockAi as never, mockRepo as never);
    await svc.query('pregunta con contexto enorme');

    const [, userPrompt] = mockAi.completeJSON.mock.calls[0] as [string, string];
    const contextPart = userPrompt.split('CONTEXTO:\n')[1] ?? '';
    expect(contextPart.length).toBeLessThanOrEqual(12_000 + 200);
  });
});
