import { afterEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/infrastructure/database/prisma.js';
import { VaultQueryService } from '@/application/vault-query/vault-query-service.js';

// Embedder y LLM fakeados; el resto (repo, prisma, vault_query_log) es real.
const fakeEmbedder = {
  isConfigured: true,
  embed: vi.fn().mockResolvedValue([[0.1, 0.2, 0.3]]),
} as unknown as ConstructorParameters<typeof VaultQueryService>[0];

const fakeAi = {
  isConfigured: true,
  completeJSON: vi.fn(),
} as unknown as ConstructorParameters<typeof VaultQueryService>[1];

const fakeRepo = {
  searchChunks: vi.fn(),
} as unknown as ConstructorParameters<typeof VaultQueryService>[2];

const svc = new VaultQueryService(fakeEmbedder, fakeAi, fakeRepo);

const createdQuestions: string[] = [];
afterEach(async () => {
  vi.mocked(fakeAi.completeJSON as ReturnType<typeof vi.fn>).mockReset();
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
    vi.mocked(fakeRepo.searchChunks as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const res = await svc.query(question, { userId: null });

    expect(res.confidence).toBe('NONE');
    expect(res.queryLogId).toBeTruthy();

    const row = await prisma.vaultQueryLog.findUnique({ where: { id: res.queryLogId! } });
    expect(row).toMatchObject({
      question,
      confidence: 'NONE',
      answeredFromContext: false,
      retrieverVersion: 'v1-cosine',
      embeddingModel: 'voyage-4-large',
    });
    expect(Array.isArray(row?.chunksReturned)).toBe(true);
    expect((row?.chunksReturned as unknown[]).length).toBe(0);
    expect(row?.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('una respuesta desde el contexto escribe una fila HIGH con los chunks usados', async () => {
    const question = `it-hit-${Date.now()}`;
    createdQuestions.push(question);
    vi.mocked(fakeRepo.searchChunks as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'c1', sourceFile: 'conocimiento/catedra/itcs.md', sourceTitle: 'ITCS', headingPath: 'Definición', content: 'El ITCS es...', distance: 0.12 },
    ]);
    vi.mocked(fakeAi.completeJSON as ReturnType<typeof vi.fn>).mockResolvedValue({
      answer: 'El ITCS es la tasa integral de costo social.',
      citations: ['conocimiento/catedra/itcs.md'],
      answeredFromContext: true,
    });

    const res = await svc.query(question, { userId: null });

    expect(res.confidence).toBe('HIGH');
    const row = await prisma.vaultQueryLog.findUnique({ where: { id: res.queryLogId! } });
    expect(row?.confidence).toBe('HIGH');
    expect(row?.answeredFromContext).toBe(true);
    const chunks = row?.chunksReturned as Array<{ sourceFile: string; distance: number }>;
    expect(chunks[0]?.sourceFile).toBe('conocimiento/catedra/itcs.md');
    expect(chunks[0]?.distance).toBeCloseTo(0.12);
  });

  it('si la escritura del log falla, la respuesta al usuario sigue saliendo', async () => {
    const question = `it-logfail-${Date.now()}`;
    createdQuestions.push(question);
    vi.mocked(fakeRepo.searchChunks as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const spy = vi
      .spyOn(prisma.vaultQueryLog, 'create')
      .mockRejectedValueOnce(new Error('DB caída'));

    const res = await svc.query(question, { userId: null });

    expect(res.confidence).toBe('NONE');
    expect(res.queryLogId).toBeUndefined();
    spy.mockRestore();
  });
});
