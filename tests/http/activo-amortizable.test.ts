import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyRequest, FastifyReply } from 'fastify';

const USER = 'user-1';
const COMPANY_ID = '00000000-0000-0000-0000-000000000001';
const COMPANY = { id: COMPANY_ID, userId: USER };
const ASSET_ID = '22222222-2222-2222-2222-222222222222';

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    company: { findFirst: vi.fn() },
    costStructure: { findFirst: vi.fn() },
    activoAmortizable: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('@/infrastructure/database/prisma.js', () => ({
  prisma: mockPrisma,
  withTenant: async (_userId: string, fn: (tx: unknown) => unknown) => fn(mockPrisma),
}));

vi.mock('@/application/audit/trace-audit.js', () => ({
  recordTraceAudit: vi.fn(async () => undefined),
}));

vi.mock('@/infrastructure/http/plugins/authenticate.js', () => ({
  authenticate: async (request: FastifyRequest, _reply: FastifyReply) => {
    (request as FastifyRequest & { authUser: object }).authUser = {
      id: USER,
      role: 'COSTISTA',
      jobTitle: null,
    };
  },
}));

async function buildTestApp() {
  const Fastify = (await import('fastify')).default;
  const { registerActivoAmortizableRoutes } = await import(
    '@/infrastructure/http/routes/activo-amortizable.routes.js'
  );
  const { errorHandler } = await import('@/infrastructure/http/error-handler.js');
  const app = Fastify({ logger: false });
  app.setErrorHandler(errorHandler);
  await app.register(registerActivoAmortizableRoutes);
  await app.ready();
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.company.findFirst.mockResolvedValue(COMPANY);
  mockPrisma.activoAmortizable.findMany.mockResolvedValue([]);
});

describe('GET /companies/:companyId/activos-amortizables', () => {
  it('200 — lista los activos de la empresa', async () => {
    mockPrisma.activoAmortizable.findMany.mockResolvedValue([{ id: ASSET_ID, nombre: 'Lote marzo' }]);
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'GET',
      url: `/companies/${COMPANY_ID}/activos-amortizables`,
    });

    expect(res.statusCode).toBe(200);
    const { data } = JSON.parse(res.body) as { data: { nombre: string }[] };
    expect(data[0]!.nombre).toBe('Lote marzo');
  });

  it('404 cuando la empresa no es de quien pide', async () => {
    mockPrisma.company.findFirst.mockResolvedValue(null);
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'GET',
      url: `/companies/${COMPANY_ID}/activos-amortizables`,
    });

    expect(res.statusCode).toBe(404);
  });
});

describe('POST /companies/:companyId/activos-amortizables', () => {
  const body = {
    nombre: 'Lote de ponedoras Hy-Line',
    costoAdquisicion: 67_200_000,
    valorResidual: 0,
    fechaAlta: '2026-03-01',
    cantidad: 6300,
  };

  it('201 — da de alta el activo', async () => {
    mockPrisma.activoAmortizable.create.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({ id: ASSET_ID, ...data }),
    );
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: `/companies/${COMPANY_ID}/activos-amortizables`,
      payload: body,
    });

    expect(res.statusCode).toBe(201);
    const { data } = JSON.parse(res.body) as { data: { nombre: string } };
    expect(data.nombre).toBe(body.nombre);
  });

  it('400 cuando el valor residual supera el costo de adquisición', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: `/companies/${COMPANY_ID}/activos-amortizables`,
      payload: { ...body, valorResidual: 999_999_999 },
    });

    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(mockPrisma.activoAmortizable.create).not.toHaveBeenCalled();
  });
});

describe('DELETE /activos-amortizables/:id', () => {
  it('200 — borrado lógico', async () => {
    mockPrisma.activoAmortizable.findFirst.mockResolvedValue({
      id: ASSET_ID,
      userId: USER,
      nombre: 'Lote marzo',
    });
    mockPrisma.activoAmortizable.update.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({ id: ASSET_ID, ...data }),
    );
    const app = await buildTestApp();
    const res = await app.inject({ method: 'DELETE', url: `/activos-amortizables/${ASSET_ID}` });

    expect(res.statusCode).toBe(200);
    const { data } = JSON.parse(res.body) as { data: { deletedAt: string } };
    expect(data.deletedAt).toBeTruthy();
  });

  it('404 cuando el activo no existe', async () => {
    mockPrisma.activoAmortizable.findFirst.mockResolvedValue(null);
    const app = await buildTestApp();
    const res = await app.inject({ method: 'DELETE', url: `/activos-amortizables/${ASSET_ID}` });

    expect(res.statusCode).toBe(404);
  });
});
