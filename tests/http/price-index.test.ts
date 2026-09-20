import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';

const USER_ID = '11111111-1111-1111-1111-111111111111';
const COMPANY_ID = '22222222-2222-2222-2222-222222222222';

const { db } = vi.hoisted(() => ({
  db: {
    company: { findFirst: vi.fn() },
    priceIndexSeries: { findUnique: vi.fn(), create: vi.fn() },
    priceIndexSeriesVersion: { create: vi.fn() },
    $queryRaw: vi.fn(),
  },
}));

vi.mock('@/infrastructure/database/prisma.js', () => ({
  prisma: db,
  withTenant: async (_userId: string, fn: (tx: typeof db) => unknown) => fn(db),
}));
vi.mock('@/application/audit/trace-audit.js', () => ({ recordTraceAudit: vi.fn(async () => undefined) }));
vi.mock('@/infrastructure/http/plugins/authenticate.js', () => ({
  authenticate: async (request: FastifyRequest, _reply: FastifyReply) => {
    (request as FastifyRequest & { authUser: object }).authUser = { id: USER_ID, role: 'COSTISTA', jobTitle: null };
  },
}));

async function app() {
  const Fastify = (await import('fastify')).default;
  const { registerPriceIndexRoutes } = await import('@/infrastructure/http/routes/price-index.routes.js');
  const { errorHandler } = await import('@/infrastructure/http/error-handler.js');
  const instance = Fastify({ logger: false });
  instance.setErrorHandler(errorHandler);
  await instance.register(registerPriceIndexRoutes);
  await instance.ready();
  return instance;
}

beforeEach(() => {
  vi.clearAllMocks();
  db.company.findFirst.mockResolvedValue({ id: COMPANY_ID, userId: USER_ID });
  db.priceIndexSeries.findUnique.mockResolvedValue(null);
  db.priceIndexSeries.create.mockResolvedValue({
    id: '33333333-3333-3333-3333-333333333333', companyId: COMPANY_ID,
    source: 'IPC manual', basePeriodCode: '2026-01', versions: [],
  });
  db.priceIndexSeriesVersion.create.mockResolvedValue({
    id: '44444444-4444-4444-4444-444444444444', version: 1, createdAt: new Date('2026-09-20T12:00:00Z'),
    values: [{ periodCode: '2026-01', indexValue: 100 }, { periodCode: '2026-07', indexValue: 150 }],
  });
});

describe('serie de índices de precios', () => {
  it('guarda la primera versión mensual con fuente y momento cero declarados', async () => {
    const instance = await app();
    const response = await instance.inject({
      method: 'PUT', url: `/companies/${COMPANY_ID}/price-index-series`,
      payload: {
        source: 'IPC manual', basePeriodCode: '2026-01',
        values: [{ periodCode: '2026-01', indexValue: 100 }, { periodCode: '2026-07', indexValue: 150 }],
      },
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).data).toMatchObject({ source: 'IPC manual', version: { number: 1 } });
  });

  it('rechaza índices no positivos sin escribir una versión', async () => {
    const instance = await app();
    const response = await instance.inject({
      method: 'PUT', url: `/companies/${COMPANY_ID}/price-index-series`,
      payload: { source: 'IPC manual', basePeriodCode: '2026-01', values: [{ periodCode: '2026-01', indexValue: 0 }] },
    });
    expect(response.statusCode).toBe(400);
    expect(db.priceIndexSeriesVersion.create).not.toHaveBeenCalled();
  });
});
