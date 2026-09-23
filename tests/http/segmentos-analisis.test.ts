import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';

const COMPANY_ID = '00000000-0000-4000-8000-000000000001';
const USER_ID = '00000000-0000-4000-8000-000000000002';
const { mockPrisma } = vi.hoisted(() => ({ mockPrisma: {
  company: { findFirst: vi.fn() },
  segmentoAnalisis: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), count: vi.fn() },
} }));

vi.mock('@/infrastructure/database/prisma.js', () => ({
  prisma: mockPrisma,
  withTenant: async (_userId: string, fn: (tx: unknown) => unknown) => fn(mockPrisma),
}));
vi.mock('@/application/audit/trace-audit.js', () => ({ recordTraceAudit: vi.fn(async () => undefined) }));
vi.mock('@/infrastructure/http/plugins/authenticate.js', () => ({
  authenticate: async (request: FastifyRequest, _reply: FastifyReply) => {
    (request as FastifyRequest & { authUser: object }).authUser = { id: USER_ID, role: 'EMPRESA_ADMIN', jobTitle: null };
  },
}));

async function buildTestApp() {
  const Fastify = (await import('fastify')).default;
  const { registerSegmentoAnalisisRoutes } = await import('@/infrastructure/http/routes/segmento-analisis.routes.js');
  const { errorHandler } = await import('@/infrastructure/http/error-handler.js');
  const app = Fastify({ logger: false });
  app.setErrorHandler(errorHandler);
  await app.register(registerSegmentoAnalisisRoutes);
  await app.ready();
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.company.findFirst.mockResolvedValue({ id: COMPANY_ID, userId: USER_ID });
  mockPrisma.segmentoAnalisis.findMany.mockResolvedValue([]);
});

describe('segmentos de análisis HTTP', () => {
  it('422 — producción conjunta con costo variable propio cita R15', async () => {
    const app = await buildTestApp();
    const response = await app.inject({
      method: 'POST', url: `/companies/${COMPANY_ID}/segmentos-analisis`,
      payload: { nombre: 'Conjunta', nivel: 'linea', produccionConjunta: true, participacion: 1, precioUnitario: null, costoVariableUnitario: 12, costoFijoDirecto: 10, prorrateoIndirectos: 0, coproductos: [{ nombre: 'Principal', precio: 100, rendimiento: 1 }] },
    });
    expect(response.statusCode).toBe(422);
    expect(JSON.parse(response.body).error.message).toMatch(/R15/);
    expect(mockPrisma.segmentoAnalisis.create).not.toHaveBeenCalled();
    await app.close();
  });

  it('empresa sin segmentos conserva el comportamiento previo: lista y análisis vacíos', async () => {
    const app = await buildTestApp();
    const listado = await app.inject({ method: 'GET', url: `/companies/${COMPANY_ID}/segmentos-analisis` });
    const equilibrio = await app.inject({ method: 'GET', url: `/companies/${COMPANY_ID}/analisis/equilibrio-sectorial` });
    expect(JSON.parse(listado.body)).toEqual({ data: [] });
    expect(JSON.parse(equilibrio.body).data).toMatchObject({ equilibrioGeneral: null, segmentos: [] });
    await app.close();
  });
});
