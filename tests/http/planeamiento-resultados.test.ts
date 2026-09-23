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
  const { registerPlaneamientoResultadosRoutes } = await import('@/infrastructure/http/routes/planeamiento-resultados.routes.js');
  const app = Fastify({ logger: false });
  app.setErrorHandler(errorHandler);
  await app.register(registerPlaneamientoResultadosRoutes);
  await app.ready();
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  db.company.findFirst.mockResolvedValue({ id: COMPANY_ID });
});

describe('POST /companies/:companyId/analisis/planeamiento-resultados', () => {
  it.each(['porcentaje_sobre_ventas', 'porcentaje_sobre_costos'])('422 — R12 rechaza %s con el ejemplo de Yardín', async (tipo) => {
    const app = await appDePrueba();
    const response = await app.inject({
      method: 'POST', url: `/companies/${COMPANY_ID}/analisis/planeamiento-resultados`,
      payload: { modalidad: 'fisica', costosFijos: 8_000, costoVariableUnitario: 30, precioUnitario: 100, unidadCantidad: 'unidades', moneda: 'ARS', objetivo: { tipo, tasa: 0.10 } },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().error).toMatchObject({ code: 'UNPROCESSABLE_ENTITY', details: { field: 'objetivo.tipo' } });
    expect(response.json().error.message).toMatch(/Yardín.*mitad/i);
    await app.close();
  });

  it('publica Qr, Vr, resultado logrado y la base del cálculo', async () => {
    const app = await appDePrueba();
    const response = await app.inject({
      method: 'POST', url: `/companies/${COMPANY_ID}/analisis/planeamiento-resultados`,
      payload: {
        modalidad: 'fisica', costosFijos: 8_000, costoVariableUnitario: 30, precioUnitario: 100, unidadCantidad: 'unidades', moneda: 'ARS',
        objetivo: { tipo: 'porcentaje_sobre_capital', tasa: 0.10, capitalFijo: 30_000, capitalPorPesoCostoVariable: 0.25 },
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({ cantidadNecesaria: expect.any(Number), ventasNecesarias: expect.any(Number), resultadoLogrado: expect.any(Number), basadoEn: 'porcentaje_sobre_capital', unidades: { cantidadNecesaria: 'unidades', ventasNecesarias: 'ARS', resultadoLogrado: 'ARS' } });
    await app.close();
  });

  it('no calcula para una empresa fuera del tenant autenticado', async () => {
    db.company.findFirst.mockResolvedValue(null);
    const app = await appDePrueba();
    const response = await app.inject({
      method: 'POST', url: `/companies/${COMPANY_ID}/analisis/planeamiento-resultados`,
      payload: { modalidad: 'monetaria', costosFijos: 8_000, margenMarcacion: 0.40, moneda: 'ARS', objetivo: { tipo: 'resultado_absoluto', importe: 4_000 } },
    });
    expect(response.statusCode).toBe(404);
    expect(db.company.findFirst).toHaveBeenCalledWith({ where: { id: COMPANY_ID, userId: USER_ID, deletedAt: null }, select: { id: true } });
    await app.close();
  });
});
