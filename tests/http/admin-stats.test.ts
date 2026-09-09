import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';

const { db } = vi.hoisted(() => ({
  db: {
    user: { count: vi.fn() },
    company: { count: vi.fn() },
    vaultChunk: { count: vi.fn() },
    dailySignal: { count: vi.fn(), groupBy: vi.fn() },
    vaultQueryLog: { count: vi.fn(), groupBy: vi.fn(), findMany: vi.fn() },
    $queryRaw: vi.fn(),
  },
}));

vi.mock('@/infrastructure/database/prisma.js', () => ({ prisma: db }));
vi.mock('@/infrastructure/http/plugins/authenticate.js', () => ({
  authenticate: async (request: FastifyRequest) => {
    (request as FastifyRequest & { authUser: object }).authUser = { id: 'admin-1', role: 'ADMIN' };
  },
  requireRole: () => async () => {},
}));

async function app() {
  const Fastify = (await import('fastify')).default;
  const { registerAdminRoutes } = await import('@/infrastructure/http/routes/admin.routes.js');
  const { errorHandler } = await import('@/infrastructure/http/error-handler.js');
  const server = Fastify({ logger: false });
  server.setErrorHandler(errorHandler);
  await server.register(registerAdminRoutes);
  await server.ready();
  return server;
}

beforeEach(() => {
  vi.clearAllMocks();
  db.user.count.mockResolvedValue(3);
  db.company.count.mockResolvedValue(8);
  db.vaultChunk.count.mockResolvedValue(120);
  db.dailySignal.count.mockResolvedValue(0);
  db.dailySignal.groupBy.mockResolvedValue([]);
  db.vaultQueryLog.count.mockResolvedValue(0);
  db.vaultQueryLog.groupBy.mockResolvedValue([]);
  db.vaultQueryLog.findMany.mockResolvedValue([]);
  db.$queryRaw.mockResolvedValue([]);
});

describe('GET /admin/stats — bloque vault', () => {
  it('no expone "rough precision"; `queryLog` es null cuando no hubo tráfico', async () => {
    const res = await (await app()).inject({ method: 'GET', url: '/admin/stats' });
    expect(res.statusCode).toBe(200);
    const { vault } = res.json().data;
    expect(vault).not.toHaveProperty('ragMisses');
    expect(vault.queryLog).toBeNull();
    expect(vault.totalChunks).toBe(120);
  });

  it('con tráfico: devuelve confianza, tasa de negativa, feedback y archivos más citados', async () => {
    db.vaultQueryLog.count.mockImplementation((args?: { where?: { feedbackUseful?: unknown } }) => {
      if (args?.where?.feedbackUseful) return Promise.resolve(4); // withFeedback
      return Promise.resolve(20); // queries7d / queries30d
    });
    db.vaultQueryLog.groupBy.mockImplementation((args: { by: string[] }) => {
      if (args.by[0] === 'confidence') {
        return Promise.resolve([
          { confidence: 'HIGH', _count: { _all: 12 } },
          { confidence: 'LOW', _count: { _all: 5 } },
          { confidence: 'NONE', _count: { _all: 3 } },
        ]);
      }
      return Promise.resolve([
        { feedbackUseful: true, _count: { _all: 3 } },
        { feedbackUseful: false, _count: { _all: 1 } },
      ]);
    });
    db.$queryRaw.mockResolvedValue([
      { sourceFile: 'conocimiento/catedra/itcs.md', uses: 9n },
      { sourceFile: 'conocimiento/procesos/p1.md', uses: 4n },
    ]);
    db.vaultQueryLog.findMany.mockResolvedValue([
      { question: '¿qué es el WACC?', createdAt: new Date('2026-09-09T10:00:00Z') },
    ]);

    const res = await (await app()).inject({ method: 'GET', url: '/admin/stats' });
    const { queryLog } = res.json().data.vault;

    expect(queryLog.queries30d).toBe(20);
    expect(queryLog.byConfidence).toEqual({ HIGH: 12, LOW: 5, NONE: 3 });
    expect(queryLog.refusalRate).toBeCloseTo(3 / 20);
    expect(queryLog.feedback).toEqual({ up: 3, down: 1, withFeedbackPct: 4 / 20 });
    expect(queryLog.topCitedFiles[0]).toEqual({ sourceFile: 'conocimiento/catedra/itcs.md', uses: 9 });
    expect(queryLog.recentMisses[0].question).toBe('¿qué es el WACC?');
  });
});
