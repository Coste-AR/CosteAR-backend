import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDb = {
  dailySignal: { findMany: vi.fn(), updateMany: vi.fn() },
  vaultEditProposal: { findMany: vi.fn(), create: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
};
vi.mock('@/infrastructure/database/prisma.js', () => ({ prisma: mockDb }));

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('node:child_process', () => ({
  execSync: vi.fn().mockReturnValue(Buffer.from('abc123')),
}));

vi.mock('@/application/vault-indexer/vault-indexer-service.js', () => ({
  VaultIndexerService: vi.fn().mockImplementation(() => ({
    indexVault: vi.fn().mockResolvedValue({ chunksUpserted: 0 }),
  })),
}));

const mockAi = { isConfigured: true, completeJSON: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  mockAi.isConfigured = true;
  mockDb.vaultEditProposal.findMany.mockResolvedValue([]);
});

describe('NightlyLearningService.runNightlyPipeline', () => {
  it('sin señales pendientes, no llama al LLM ni crea propuestas', async () => {
    const { NightlyLearningService } = await import('@/application/nightly-learning/nightly-learning-service.js');
    mockDb.dailySignal.findMany.mockResolvedValue([]);

    const svc = new NightlyLearningService(mockAi as never);
    await svc.runNightlyPipeline();

    expect(mockAi.completeJSON).not.toHaveBeenCalled();
    expect(mockDb.vaultEditProposal.create).not.toHaveBeenCalled();
  });

  it('crea una propuesta nueva para una señal procesada y la marca PROCESSED', async () => {
    const { NightlyLearningService } = await import('@/application/nightly-learning/nightly-learning-service.js');
    mockDb.dailySignal.findMany.mockResolvedValue([
      { id: 'sig-1', source: 'COSTISTA_CHAT', type: 'RAG_MISS', content: '¿Qué es el ITCS?' },
    ]);
    mockAi.completeJSON.mockResolvedValue({
      proposals: [{
        action: 'create',
        mergeIntoProposalId: null,
        title: 'Agregar definición de ITCS',
        sourceFile: 'Costeo/ITCS.md',
        proposedText: 'El ITCS es...',
        justification: 'Pregunta frecuente sin respuesta en la bóveda',
        groundedInSignals: false,
        signalsUsedIds: ['sig-1'],
      }],
    });

    const svc = new NightlyLearningService(mockAi as never);
    await svc.runNightlyPipeline();

    expect(mockDb.vaultEditProposal.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: 'Agregar definición de ITCS',
          status: 'PENDING',
          requiresVerification: true,
        }),
      }),
    );
    expect(mockDb.dailySignal.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['sig-1'] } },
      data: { status: 'PROCESSED' },
    });
  });

  it('señales que el LLM no usó en ninguna propuesta se marcan REJECTED', async () => {
    const { NightlyLearningService } = await import('@/application/nightly-learning/nightly-learning-service.js');
    mockDb.dailySignal.findMany.mockResolvedValue([
      { id: 'sig-1', source: 'COSTISTA_CHAT', type: 'RAG_MISS', content: 'pregunta irrelevante' },
    ]);
    mockAi.completeJSON.mockResolvedValue({ proposals: [] });

    const svc = new NightlyLearningService(mockAi as never);
    await svc.runNightlyPipeline();

    expect(mockDb.vaultEditProposal.create).not.toHaveBeenCalled();
    expect(mockDb.dailySignal.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['sig-1'] } },
      data: { status: 'REJECTED' },
    });
  });

  it('un "merge" contra una propuesta pendiente real suma signalsUsed sin crear una fila nueva', async () => {
    const { NightlyLearningService } = await import('@/application/nightly-learning/nightly-learning-service.js');
    mockDb.dailySignal.findMany.mockResolvedValue([
      { id: 'sig-2', source: 'COSTISTA_CHAT', type: 'RAG_MISS', content: 'otra pregunta sobre ITCS' },
    ]);
    mockDb.vaultEditProposal.findMany.mockResolvedValue([
      { id: 'prop-1', title: 'Agregar ITCS', sourceFile: 'Costeo/ITCS.md', proposedText: 'texto previo' },
    ]);
    mockDb.vaultEditProposal.findUnique.mockResolvedValue({
      id: 'prop-1',
      signalsUsed: ['sig-1'],
    });
    mockAi.completeJSON.mockResolvedValue({
      proposals: [{
        action: 'merge',
        mergeIntoProposalId: 'prop-1',
        title: '', sourceFile: '', proposedText: '', justification: '',
        groundedInSignals: false,
        signalsUsedIds: ['sig-2'],
      }],
    });

    const svc = new NightlyLearningService(mockAi as never);
    await svc.runNightlyPipeline();

    expect(mockDb.vaultEditProposal.create).not.toHaveBeenCalled();
    expect(mockDb.vaultEditProposal.update).toHaveBeenCalledWith({
      where: { id: 'prop-1' },
      data: { signalsUsed: ['sig-1', 'sig-2'] },
    });
  });

  it('si el ai no está configurado, no procesa nada (skip silencioso documentado)', async () => {
    const { NightlyLearningService } = await import('@/application/nightly-learning/nightly-learning-service.js');
    mockAi.isConfigured = false;

    const svc = new NightlyLearningService(mockAi as never);
    await svc.runNightlyPipeline();

    expect(mockDb.dailySignal.findMany).not.toHaveBeenCalled();
  });
});
