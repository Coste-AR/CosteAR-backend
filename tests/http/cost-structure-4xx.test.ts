import { beforeEach, describe, expect, it, vi } from 'vitest';

const USER_ID = 'user-1';
const COMPANY_ID = '00000000-0000-4000-8000-000000000001';
const STRUCTURE_ID = '11111111-1111-4111-8111-111111111111';

const mockDb = vi.hoisted(() => ({
  company: { findFirst: vi.fn() },
  costStructure: { findFirst: vi.fn() },
  calculationRun: { count: vi.fn() },
  costCalculation: { count: vi.fn() },
  $transaction: vi.fn(),
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

async function request(method: string, url: string, payload: unknown) {
  const app = await buildTestApp();
  const response = await app.inject({
    method,
    url,
    headers: { authorization: 'Bearer test-token' },
    payload,
  });
  await app.close();
  return response;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(mockDb));
});

describe('rutas de escritura de estructuras de costos: contratos 4xx', () => {
  it('POST /companies/:companyId/cost-structures devuelve 400 ante un alta sin producto', async () => {
    const response = await request('POST', `/companies/${COMPANY_ID}/cost-structures`, {});

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
    expect(mockDb.company.findFirst).not.toHaveBeenCalled();
  });

  it('PATCH /cost-structures/:id/costing-system devuelve 422 si ya hay cálculos', async () => {
    mockDb.costStructure.findFirst.mockResolvedValue({ id: STRUCTURE_ID, costingSystem: 'ORDERS' });
    mockDb.calculationRun.count.mockResolvedValue(1);
    mockDb.costCalculation.count.mockResolvedValue(0);

    const response = await request('PATCH', `/cost-structures/${STRUCTURE_ID}/costing-system`, {
      costingSystem: 'PROCESSES',
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('UNPROCESSABLE_ENTITY');
  });

  it('PATCH /cost-structures/:id/late-data-policy devuelve 400 ante una política inválida', async () => {
    const response = await request('PATCH', `/cost-structures/${STRUCTURE_ID}/late-data-policy`, {
      lateDataPolicy: 'INVALID',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('DELETE /cost-structures/:id devuelve 404 si la estructura no existe', async () => {
    mockDb.costStructure.findFirst.mockResolvedValue(null);

    const response = await request('DELETE', `/cost-structures/${STRUCTURE_ID}`, undefined);

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('NOT_FOUND');
  });

  it('POST /cost-structures/:id/purge devuelve 400 si la confirmación no coincide', async () => {
    mockDb.costStructure.findFirst.mockResolvedValue({ id: STRUCTURE_ID, productName: 'Producto de prueba' });

    const response = await request('POST', `/cost-structures/${STRUCTURE_ID}/purge`, {
      confirm: 'otro producto',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('POST /cost-structures/:id/restore devuelve 404 si la estructura no existe', async () => {
    mockDb.costStructure.findFirst.mockResolvedValue(null);

    const response = await request('POST', `/cost-structures/${STRUCTURE_ID}/restore`, undefined);

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('NOT_FOUND');
  });

  it('POST /cost-structures/:id/import-excel devuelve 400 sin archivo', async () => {
    const response = await request('POST', `/cost-structures/${STRUCTURE_ID}/import-excel`, {
      fileBase64: '',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('PUT /cost-structures/:id/sales devuelve 400 ante una venta incompleta', async () => {
    const response = await request('PUT', `/cost-structures/${STRUCTURE_ID}/sales`, {
      salesUnitPrice: 1_500,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('PUT /cost-structures/:id/third-party-work devuelve 400 ante un importe negativo', async () => {
    const response = await request('PUT', `/cost-structures/${STRUCTURE_ID}/third-party-work`, {
      thirdPartyWork: -1,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('POST /cost-structures/:id/simulate devuelve 422 para Costeo por Procesos', async () => {
    mockDb.costStructure.findFirst.mockResolvedValue({
      id: STRUCTURE_ID,
      productName: 'Producto de prueba',
      costingSystem: 'PROCESSES',
    });

    const response = await request('POST', `/cost-structures/${STRUCTURE_ID}/simulate`, {});

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('UNPROCESSABLE_ENTITY');
  });
});
