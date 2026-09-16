import { beforeEach, describe, expect, it, vi } from 'vitest';

const { setGastosDeNoFabricacion } = vi.hoisted(() => ({
  setGastosDeNoFabricacion: vi.fn(),
}));

vi.mock('@/application/cost-structures/cost-period-service.js', () => ({
  CostPeriodService: class {
    setGastosDeNoFabricacion = setGastosDeNoFabricacion;
  },
}));

vi.mock('@/application/cost-structures/cost-period-propagation-service.js', () => ({
  CostPeriodPropagationService: class {},
}));

vi.mock('@/infrastructure/http/plugins/authenticate.js', () => ({
  authenticate: async (request: { authUser?: unknown }) => {
    request.authUser = { id: 'user-1', role: 'COSTISTA' };
  },
  auditContext: () => ({}),
}));

const PERIOD_ID = '11111111-1111-4111-8111-111111111111';

async function app() {
  const Fastify = (await import('fastify')).default;
  const { registerCostPeriodRoutes } = await import('@/infrastructure/http/routes/cost-period.routes.js');
  const { errorHandler } = await import('@/infrastructure/http/error-handler.js');
  const server = Fastify({ logger: false });
  server.setErrorHandler(errorHandler);
  await server.register(registerCostPeriodRoutes);
  await server.ready();
  return server;
}

beforeEach(() => vi.clearAllMocks());

/**
 * M2-01 (plan de análisis marginal v2). `PUT /periods/:id/gastos-no-fabricacion`
 * es el único camino para cargar el gasto variable de comercialización y el
 * fijo de administración — sin él, los dos nuevos componentes de la
 * contribución marginal (`calculation-result-enrichment.ts`) siempre valen
 * $0 porque no hay ningún endpoint que los escriba.
 */
describe('PUT /periods/:id/gastos-no-fabricacion', () => {
  it('persiste los dos importes', async () => {
    setGastosDeNoFabricacion.mockResolvedValue({
      id: PERIOD_ID, gastoVariableComercializacionPorUnidad: 30, gastoFijoAdministracion: 56000,
    });

    const server = await app();
    const response = await server.inject({
      method: 'PUT',
      url: `/periods/${PERIOD_ID}/gastos-no-fabricacion`,
      payload: { gastoVariableComercializacionPorUnidad: 30, gastoFijoAdministracion: 56000 },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({ gastoVariableComercializacionPorUnidad: 30, gastoFijoAdministracion: 56000 });
    expect(setGastosDeNoFabricacion).toHaveBeenCalledWith(
      'user-1', PERIOD_ID,
      { gastoVariableComercializacionPorUnidad: 30, gastoFijoAdministracion: 56000 },
      {},
    );
  });

  it('rechaza un importe negativo con 400', async () => {
    const server = await app();
    const response = await server.inject({
      method: 'PUT',
      url: `/periods/${PERIOD_ID}/gastos-no-fabricacion`,
      payload: { gastoVariableComercializacionPorUnidad: -1, gastoFijoAdministracion: 0 },
    });

    expect(response.statusCode).toBe(400);
    expect(setGastosDeNoFabricacion).not.toHaveBeenCalled();
  });
});
