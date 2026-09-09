import { afterEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/infrastructure/database/prisma.js';
import { VaultQueryService } from '@/application/vault-query/vault-query-service.js';

// Retriever y LLM fakeados; prisma / vault_query_log son reales.
const fakeRetriever = { retrieve: vi.fn() } as unknown as ConstructorParameters<typeof VaultQueryService>[0];
const fakeAi = { isConfigured: true, completeJSON: vi.fn() } as unknown as ConstructorParameters<typeof VaultQueryService>[1];

const svc = new VaultQueryService(fakeRetriever, fakeAi);
const retrieve = fakeRetriever.retrieve as unknown as ReturnType<typeof vi.fn>;
const completeJSON = (fakeAi as { completeJSON: ReturnType<typeof vi.fn> }).completeJSON;

function chunk(over: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    sourceFile: 'conocimiento/catedra/itcs.md',
    sourceTitle: 'ITCS',
    headingPath: 'Definición',
    content: 'El ITCS es...',
    sourceType: 'CATEDRA',
    vectorRank: 1,
    ftsRank: null,
    distance: 0.12,
    rrfScore: 0.9,
    rerankScore: null,
    ...over,
  };
}

const createdQuestions: string[] = [];
afterEach(async () => {
  retrieve.mockReset();
  completeJSON.mockReset();
  if (createdQuestions.length) {
    await prisma.vaultQueryLog.deleteMany({ where: { question: { in: createdQuestions } } });
    await prisma.dailySignal.deleteMany({ where: { content: { in: createdQuestions } } });
    createdQuestions.length = 0;
  }
});

describe('VaultQueryService.query — vault_query_log', () => {
  it('un miss (sin chunks) escribe una fila con confidence NONE', async () => {
    const question = `it-miss-${Date.now()}`;
    createdQuestions.push(question);
    retrieve.mockResolvedValue([]);

    const res = await svc.query(question, { userId: null });

    expect(res.confidence).toBe('NONE');
    expect(res.queryLogId).toBeTruthy();

    const row = await prisma.vaultQueryLog.findUnique({ where: { id: res.queryLogId! } });
    expect(row).toMatchObject({
      question,
      confidence: 'NONE',
      answeredFromContext: false,
      retrieverVersion: 'v3-hybrid-rrf-rerank',
      embeddingModel: 'voyage-4-large',
    });
    expect((row?.chunksReturned as unknown[]).length).toBe(0);
    expect(row?.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('una respuesta desde el contexto escribe una fila HIGH con los chunks usados', async () => {
    const question = `it-hit-${Date.now()}`;
    createdQuestions.push(question);
    retrieve.mockResolvedValue([chunk({ distance: 0.12, rrfScore: 0.7 })]);
    completeJSON.mockResolvedValue({
      answer: 'El ITCS es la tasa integral de costo social.',
      citations: ['conocimiento/catedra/itcs.md'],
      answeredFromContext: true,
    });

    const res = await svc.query(question, { userId: null });

    expect(res.confidence).toBe('HIGH');
    const row = await prisma.vaultQueryLog.findUnique({ where: { id: res.queryLogId! } });
    expect(row?.confidence).toBe('HIGH');
    const chunks = row?.chunksReturned as Array<{ sourceFile: string; distance: number; rrfScore: number }>;
    expect(chunks[0]?.sourceFile).toBe('conocimiento/catedra/itcs.md');
    expect(chunks[0]?.distance).toBeCloseTo(0.12);
    expect(chunks[0]?.rrfScore).toBeCloseTo(0.7);
  });

  it('si la escritura del log falla, la respuesta al usuario sigue saliendo', async () => {
    const question = `it-logfail-${Date.now()}`;
    createdQuestions.push(question);
    retrieve.mockResolvedValue([]);
    const spy = vi.spyOn(prisma.vaultQueryLog, 'create').mockRejectedValueOnce(new Error('DB caída'));

    const res = await svc.query(question, { userId: null });

    expect(res.confidence).toBe('NONE');
    expect(res.queryLogId).toBeUndefined();
    spy.mockRestore();
  });
});
