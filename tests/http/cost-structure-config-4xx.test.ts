import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

const USER_ID = 'user-1';
const STRUCTURE_ID = '11111111-1111-4111-8111-111111111111';

const mockDb = vi.hoisted(() => ({
  costStructure: { findFirst: vi.fn(), update: vi.fn() },
}));

vi.mock('@/infrastructure/database/prisma.js', () => ({
  prisma: mockDb,
  withTenant: async (_userId: string, fn: (tx: unknown) => unknown) => fn(mockDb),
}));

vi.mock('@/infrastructure/http/plugins/authenticate.js', () => ({
  authenticate: async (request: { authUser?: unknown }) => {
    request.authUser = { id: USER_ID, role: 'COSTISTA' };
  },
  auditContext: () => ({ ipAddress: '127.0.0.1', userAgent: 'test' }),
}));

async function buildTestApp() {
  const Fastify = (await import('fastify')).default;
  const { registerCostStructureRoutes } = await import(
    '@/infrastructure/http/routes/cost-structure.routes.js'
  );
  const { errorHandler } = await import('@/infrastructure/http/error-handler.js');

  const app = Fastify({ logger: false });
  app.setErrorHandler(errorHandler);
  await app.register(registerCostStructureRoutes);
  await app.ready();
  return app;
}

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildTestApp();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.costStructure.findFirst.mockResolvedValue({ id: STRUCTURE_ID });
});

describe('PUT /cost-structures/:id/{raw-material,direct-labor}: contratos 4xx', () => {
  it('raw-material devuelve 400 de validación antes de persistir una configuración vacía', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: `/cost-structures/${STRUCTURE_ID}/raw-material`,
      headers: { authorization: 'Bearer test-token' },
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
    expect(mockDb.costStructure.update).not.toHaveBeenCalled();
  });

  it('direct-labor devuelve 400 de validación antes de persistir una configuración vacía', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: `/cost-structures/${STRUCTURE_ID}/direct-labor`,
      headers: { authorization: 'Bearer test-token' },
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
    expect(mockDb.costStructure.update).not.toHaveBeenCalled();
  });
});
