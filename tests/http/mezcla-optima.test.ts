import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';

const COMPANY_ID = '00000000-0000-4000-8000-000000000001';
const USER_ID = '00000000-0000-4000-8000-000000000002';
const { db } = vi.hoisted(() => ({ db: {
  company: { findFirst: vi.fn() },
  recursoEscaso: { findMany: vi.fn() },
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
  const { registerMezclaOptimaRoutes } = await import('@/infrastructure/http/routes/mezcla-optima.routes.js');
  const app = Fastify({ logger: false });
  app.setErrorHandler(errorHandler);
  await app.register(registerMezclaOptimaRoutes);
  await app.ready();
  return app;
}

const recurso = (activo: boolean) => ({
  id: '00000000-0000-4000-8000-000000000010', clave: 'horas-maquina', disponibleEnPeriodo: 1_000,
  esCuelloDeBotellaActivo: activo, unidad: { codigo: 'hora-maquina', nombre: 'Horas máquina' },
  consumos: [
    { consumoPorUnidad: 3, demandaMaxima: 200, segmento: { id: '00000000-0000-4000-8000-000000000011', nombre: 'X', precioUnitario: 500, costoVariableUnitario: 200, produccionConjunta: false, coproductos: [] } },
    { consumoPorUnidad: 1, demandaMaxima: 400, segmento: { id: '00000000-0000-4000-8000-000000000012', nombre: 'Y', precioUnitario: 400, costoVariableUnitario: 200, produccionConjunta: false, coproductos: [] } },
    { consumoPorUnidad: 8, demandaMaxima: 100, segmento: { id: '00000000-0000-4000-8000-000000000013', nombre: 'Z', precioUnitario: 600, costoVariableUnitario: 200, produccionConjunta: false, coproductos: [] } },
  ],
});

beforeEach(() => {
  vi.clearAllMocks();
  db.company.findFirst.mockResolvedValue({ id: COMPANY_ID });
  db.recursoEscaso.findMany.mockResolvedValue([recurso(true)]);
});

describe('GET /companies/:companyId/analisis/mezcla-optima', () => {
  it('publica AM-06 y mantiene la unidad junto a los valores', async () => {
    const app = await appDePrueba();
    const response = await app.inject({ method: 'GET', url: `/companies/${COMPANY_ID}/analisis/mezcla-optima` });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      recurso: { clave: 'horas-maquina', disponibleEnPeriodo: 1_000, unidad: 'hora-maquina' },
      contribucionMarginalTotal: 140_000,
      motivoSinRanking: null,
    });
    expect(response.json().data.ranking[0]).toMatchObject({ producto: 'Y', cme: 200, cm: 200 });
    await app.close();
  });

  it('sin cuello de botella activo declara ausencia y no publica ranking', async () => {
    db.recursoEscaso.findMany.mockResolvedValue([recurso(false)]);
    const app = await appDePrueba();
    const response = await app.inject({ method: 'GET', url: `/companies/${COMPANY_ID}/analisis/mezcla-optima` });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual({
      recurso: null, ranking: [], contribucionMarginalTotal: null, recursoRestante: null,
      motivoSinRanking: 'No hay un cuello de botella activo; marcá el recurso que limita la producción para calcular el ranking.',
    });
    await app.close();
  });

  it('con dos recursos activos devuelve 422 accionable en vez de aplicar la heurística', async () => {
    db.recursoEscaso.findMany.mockResolvedValue([recurso(true), { ...recurso(true), id: '00000000-0000-4000-8000-000000000020', clave: 'capital-trabajo' }]);
    const app = await appDePrueba();
    const response = await app.inject({ method: 'GET', url: `/companies/${COMPANY_ID}/analisis/mezcla-optima` });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ error: { code: 'UNPROCESSABLE_ENTITY' } });
    expect(response.json().error.message).toMatch(/desactivá.*recurso|programación lineal/i);
    await app.close();
  });
});
