import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { relacionReemplazoEnvelopeSchema } from '@/shared/schemas/relacion-reemplazo.schema.js';

const COMPANY_ID = '00000000-0000-4000-8000-000000000001';
const USER_ID = '00000000-0000-4000-8000-000000000002';
const ORIGEN_ID = '00000000-0000-4000-8000-000000000003';
const DESTINO_ID = '00000000-0000-4000-8000-000000000004';
const { db } = vi.hoisted(() => ({ db: {
  company: { findFirst: vi.fn() },
  segmentoAnalisis: { findMany: vi.fn() },
} }));

vi.mock('@/infrastructure/database/prisma.js', () => ({
  prisma: db,
  withTenant: async (_userId: string, fn: (tx: typeof db) => unknown) => fn(db),
}));
vi.mock('@/infrastructure/http/plugins/authenticate.js', () => ({
  authenticate: async (request: FastifyRequest, _reply: FastifyReply) => {
    (request as FastifyRequest & { authUser: object }).authUser = { id: USER_ID, role: 'EMPRESA_ADMIN', jobTitle: null };
  },
}));

async function appDePrueba() {
  const Fastify = (await import('fastify')).default;
  const { errorHandler } = await import('@/infrastructure/http/error-handler.js');
  const { registerRelacionReemplazoRoutes } = await import('@/infrastructure/http/routes/relacion-reemplazo.routes.js');
  const app = Fastify({ logger: false });
  app.setErrorHandler(errorHandler);
  await app.register(registerRelacionReemplazoRoutes);
  await app.ready();
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  db.company.findFirst.mockResolvedValue({ id: COMPANY_ID });
  db.segmentoAnalisis.findMany.mockResolvedValue([
    { id: ORIGEN_ID, nombre: 'A', precioUnitario: 100, costoVariableUnitario: 60, costoFijoDirecto: 20_000, prorrateoIndirectos: 2_400, produccionConjunta: false, coproductos: [] },
    { id: DESTINO_ID, nombre: 'B', precioUnitario: 60, costoVariableUnitario: 40, costoFijoDirecto: 6_000, prorrateoIndirectos: 3_600, produccionConjunta: false, coproductos: [] },
    { id: '00000000-0000-4000-8000-000000000005', nombre: 'C', precioUnitario: 40, costoVariableUnitario: 28, costoFijoDirecto: 2_000, prorrateoIndirectos: 6_000, produccionConjunta: false, coproductos: [] },
  ]);
});

const payload = {
  segmentoOrigenId: ORIGEN_ID,
  segmentoDestinoId: DESTINO_ID,
  cantidadOrigen: 50,
  resultadoObjetivo: 0,
  unidadCantidad: 'unidades',
};

describe('POST /companies/:companyId/analisis/relacion-reemplazo', () => {
  it('publica AM-03 con corto y largo plazo siempre juntos', async () => {
    const app = await appDePrueba();
    const response = await app.inject({ method: 'POST', url: `/companies/${COMPANY_ID}/analisis/relacion-reemplazo`, payload });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      relacionReemplazo: 2,
      cantidadOrigen: 50,
      cantidadDestino: 100,
      resultadoCortoPlazo: 1_900,
      resultadoLargoPlazo: 900,
    });
    await app.close();
  });

  it('el contrato rechaza una respuesta que omite uno de los horizontes', () => {
    expect(() => relacionReemplazoEnvelopeSchema.parse({
      data: {
        relacionReemplazo: 2,
        cantidadOrigen: 50,
        cantidadDestino: 100,
        resultadoCortoPlazo: 1_900,
        unidades: { cantidadOrigen: 'unidades', cantidadDestino: 'unidades', resultadoCortoPlazo: 'unidades', resultadoLargoPlazo: 'unidades' },
      },
    })).toThrow();
  });

  it('no mezcla segmentos de otra empresa o borrados', async () => {
    db.segmentoAnalisis.findMany.mockResolvedValue([]);
    const app = await appDePrueba();
    const response = await app.inject({ method: 'POST', url: `/companies/${COMPANY_ID}/analisis/relacion-reemplazo`, payload });

    expect(response.statusCode).toBe(404);
    expect(db.segmentoAnalisis.findMany).toHaveBeenCalledWith({
      where: { companyId: COMPANY_ID, deletedAt: null },
      select: expect.objectContaining({ id: true }),
    });
    await app.close();
  });
});
