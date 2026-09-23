import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';

const COMPANY_ID = '00000000-0000-4000-8000-000000000001';
const USER_ID = '00000000-0000-4000-8000-000000000002';
const { db } = vi.hoisted(() => ({ db: { company: { findFirst: vi.fn() } } }));

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
  const { registerPuntoIndiferenciaRoutes } = await import('@/infrastructure/http/routes/punto-indiferencia.routes.js');
  const app = Fastify({ logger: false });
  app.setErrorHandler(errorHandler);
  await app.register(registerPuntoIndiferenciaRoutes);
  await app.ready();
  return app;
}

const payload = {
  tipoDecision: 'comparar_estructuras',
  estructuraA: { nombre: 'alta tecnología', costosFijos: 300_000, costoVariableUnitario: 100 },
  estructuraB: { nombre: 'baja tecnología', costosFijos: 100_000, costoVariableUnitario: 150 },
  unidadCantidad: 'unidades',
  moneda: 'ARS',
};

beforeEach(() => {
  vi.clearAllMocks();
  db.company.findFirst.mockResolvedValue({ id: COMPANY_ID });
});

describe('POST /companies/:companyId/analisis/punto-indiferencia', () => {
  it('publica el punto, costo y rangos de conveniencia de AM-04', async () => {
    const app = await appDePrueba();
    const response = await app.inject({ method: 'POST', url: `/companies/${COMPANY_ID}/analisis/punto-indiferencia`, payload });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      cantidadIndiferencia: 4_000,
      costoEnElPunto: 700_000,
      convieneA: { desde: 4_000, hasta: null },
      convieneB: { desde: 0, hasta: 4_000 },
      motivoSinPunto: null,
    });
    await app.close();
  });

  it('devuelve ausencia declarada cuando no hay punto', async () => {
    const app = await appDePrueba();
    const response = await app.inject({
      method: 'POST', url: `/companies/${COMPANY_ID}/analisis/punto-indiferencia`,
      payload: { ...payload, estructuraB: { ...payload.estructuraB, costoVariableUnitario: 100 } },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({ cantidadIndiferencia: null, costoEnElPunto: null, motivoSinPunto: expect.any(String) });
    await app.close();
  });

  it('no calcula para una empresa fuera del tenant autenticado', async () => {
    db.company.findFirst.mockResolvedValue(null);
    const app = await appDePrueba();
    const response = await app.inject({ method: 'POST', url: `/companies/${COMPANY_ID}/analisis/punto-indiferencia`, payload });
    expect(response.statusCode).toBe(404);
    expect(db.company.findFirst).toHaveBeenCalledWith({ where: { id: COMPANY_ID, userId: USER_ID, deletedAt: null }, select: { id: true } });
    await app.close();
  });
});
