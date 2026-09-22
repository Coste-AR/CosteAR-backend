import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';

const { mockDb } = vi.hoisted(() => ({
  mockDb: { macroSnapshot: { findFirst: vi.fn(), findMany: vi.fn() } },
}));

vi.mock('@/infrastructure/database/prisma.js', () => ({ prisma: mockDb }));
vi.mock('@/infrastructure/workers/queues.js', () => ({ macroSyncQueue: { add: vi.fn() } }));
vi.mock('@/infrastructure/http/plugins/authenticate.js', () => ({
  authenticate: async (request: FastifyRequest, _reply: FastifyReply) => {
    (request as FastifyRequest & { authUser: object }).authUser = {
      id: 'user-1', tenantId: 'tenant-1', role: 'EMPRESA_ADMIN', jobTitle: null,
    };
  },
}));

async function buildTestApp() {
  const Fastify = (await import('fastify')).default;
  const { registerMacroRoutes } = await import('@/infrastructure/http/routes/macro.routes.js');
  const { errorHandler } = await import('@/infrastructure/http/error-handler.js');
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(errorHandler);
  await app.register(registerMacroRoutes);
  await app.ready();
  return app;
}

beforeEach(() => vi.clearAllMocks());

describe('GET /indicadores/capia/vigentes', () => {
  it('devuelve unidad, IVA, fuente, título y rango de la última semana', async () => {
    const effectiveDate = new Date('2026-09-07T00:00:00.000Z');
    const metadata = {
      unit: 'cajon', ivaPct: 21, priceIncludesIva: true,
      effectiveTo: '2026-09-13T00:00:00.000Z', sourceLabel: 'ENCUESTA SEMANAL 36/2026',
      productId: 251, product: 'Huevo blanco grande puesto en granja (x cajón)',
      category: 'PRECIO DE VENTA DE PRODUCTOS AVICOLAS',
    };
    mockDb.macroSnapshot.findFirst.mockResolvedValue({ effectiveDate });
    mockDb.macroSnapshot.findMany.mockResolvedValue([
      { indicatorCode: 'CAPIA_HUEVO_BLANCO_CAJON', value: '45461.54', effectiveDate, metadata },
    ]);

    const response = await (await buildTestApp()).inject({ method: 'GET', url: '/indicadores/capia/vigentes' });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual({
      semana: {
        sourceLabel: 'ENCUESTA SEMANAL 36/2026',
        effectiveFrom: '2026-09-07T00:00:00.000Z',
        effectiveTo: '2026-09-13T00:00:00.000Z',
      },
      items: [expect.objectContaining({
        indicatorCode: 'CAPIA_HUEVO_BLANCO_CAJON', value: 45461.54, unit: 'cajon',
        ivaPct: 21, priceIncludesIva: true, source: 'CAPIA',
        sourceLabel: 'ENCUESTA SEMANAL 36/2026',
        effectiveFrom: '2026-09-07T00:00:00.000Z', effectiveTo: '2026-09-13T00:00:00.000Z',
      })],
    });
  });

  it('con la tabla vacía devuelve lista vacía y semana null', async () => {
    mockDb.macroSnapshot.findFirst.mockResolvedValue(null);
    const response = await (await buildTestApp()).inject({ method: 'GET', url: '/indicadores/capia/vigentes' });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual({ semana: null, items: [] });
    expect(mockDb.macroSnapshot.findMany).not.toHaveBeenCalled();
  });
});
