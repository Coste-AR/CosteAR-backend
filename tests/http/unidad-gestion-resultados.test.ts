import { beforeEach, describe, expect, it, vi } from 'vitest';

const { calculate, compare } = vi.hoisted(() => ({
  calculate: vi.fn(),
  compare: vi.fn(),
}));

vi.mock('@/application/cost-structures/calculation-run-service.js', () => ({
  CalculationRunService: class {
    calculate = calculate;
  },
}));

vi.mock('@/application/cost-structures/cost-period-service.js', () => ({
  CostPeriodService: class {
    compare = compare;
  },
}));

vi.mock('@/infrastructure/http/plugins/authenticate.js', () => ({
  authenticate: async (request: { authUser?: unknown }) => {
    request.authUser = { id: 'user-1', role: 'COSTISTA' };
  },
  auditContext: () => ({}),
}));

const STRUCTURE_ID = '11111111-1111-4111-8111-111111111111';
const unidadGestion = { codigo: 'bulto', nombre: 'Bulto de prueba', factor: 12 };

async function calculationApp() {
  const Fastify = (await import('fastify')).default;
  const { registerTrazabilidadRoutes } = await import('@/infrastructure/http/routes/trazabilidad.routes.js');
  const app = Fastify({ logger: false });
  await app.register(registerTrazabilidadRoutes);
  await app.ready();
  return app;
}

async function comparisonApp() {
  const Fastify = (await import('fastify')).default;
  const { registerCostPeriodRoutes } = await import('@/infrastructure/http/routes/cost-period.routes.js');
  const app = Fastify({ logger: false });
  await app.register(registerCostPeriodRoutes);
  await app.ready();
  return app;
}

beforeEach(() => vi.clearAllMocks());

describe('contrato HTTP de unidad de gestión en resultados', () => {
  it('cálculo acompaña costo unitario y punto de equilibrio con la unidad', async () => {
    calculate.mockResolvedValue({
      run: { id: 'run-1', runN: 1 },
      calculation: { id: 'calculation-1' },
      results: {
        unidadGestion,
        detail: { unitCost: { unitProductionCost: 30 } },
        puntoEquilibrio: { unidadesEquilibrio: 2 },
      },
      incompletitud: { incompleto: false },
      tree: [],
    });
    const app = await calculationApp();

    const response = await app.inject({ method: 'POST', url: `/structures/${STRUCTURE_ID}/calculate` });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json().data.results).toMatchObject({
      unidadGestion,
      detail: { unitCost: { unitProductionCost: 30 } },
      puntoEquilibrio: { unidadesEquilibrio: 2 },
    });
  });

  it('cálculo declara null cuando la empresa no eligió unidad', async () => {
    calculate.mockResolvedValue({
      run: { id: 'run-1', runN: 1 },
      calculation: { id: 'calculation-1' },
      results: {
        unidadGestion: null,
        detail: { unitCost: { unitProductionCost: 2.5 } },
        puntoEquilibrio: { unidadesEquilibrio: 24 },
      },
      incompletitud: { incompleto: false },
      tree: [],
    });
    const app = await calculationApp();

    const response = await app.inject({ method: 'POST', url: `/structures/${STRUCTURE_ID}/calculate` });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json().data.results.unidadGestion).toBeNull();
  });

  it('comparación expone la unidad o su ausencia explícita', async () => {
    compare.mockResolvedValueOnce({
      unidadGestion,
      units: { from: 2, to: 3, comparable: true },
      unit: { productionCost: { a: 30, b: 36, delta: 6, deltaPct: 20 } },
    });
    const app = await comparisonApp();
    const withUnit = await app.inject({ method: 'GET', url: `/structures/${STRUCTURE_ID}/periods/compare` });

    compare.mockResolvedValueOnce({ unidadGestion: null, units: { from: 24, to: 36, comparable: true } });
    const withoutUnit = await app.inject({ method: 'GET', url: `/structures/${STRUCTURE_ID}/periods/compare` });
    await app.close();

    expect(withUnit.statusCode).toBe(200);
    expect(withUnit.json().data).toMatchObject({ unidadGestion, units: { from: 2, to: 3 } });
    expect(withoutUnit.statusCode).toBe(200);
    expect(withoutUnit.json().data.unidadGestion).toBeNull();
  });
});
