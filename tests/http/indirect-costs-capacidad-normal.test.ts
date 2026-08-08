import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * CAPACIDAD NORMAL EN 0 — el 500 crudo reproducido en auditoría.
 *
 * Antes: `PUT /cost-structures/:id/indirect-costs` con `normalCapacity: 0`
 * devolvía **200 OK**, y el `POST /cost-structures/:id/calculate` siguiente
 * moría con un **500** ("División por cero en cálculo monetario", tirado por
 * `Money.divide` desde `calcVarianceAnalysis`).
 *
 * Ahora, a nivel HTTP:
 *   · guardar con bp = 0 → **422** accionable que nombra el centro;
 *   · calcular una estructura que YA tenía bp = 0 guardado de antes (el
 *     poblador automático de documentos escribe directo en Prisma y las sigue
 *     creando) → el **mismo 422**, nunca un 500.
 */

const db = vi.hoisted(() => ({
  costStructure: { findFirst: vi.fn(), update: vi.fn() },
  costPeriod: { findFirst: vi.fn(), update: vi.fn() },
  costConfigVersion: { findFirst: vi.fn(), create: vi.fn() },
  costCalculation: { create: vi.fn() },
  $transaction: vi.fn(),
}));

vi.mock('@/infrastructure/database/prisma.js', () => ({
  prisma: db,
  withTenant: vi.fn(async (_userId: string, fn: (tx: unknown) => unknown) => fn(db)),
}));
vi.mock('@/application/audit/audit-logger.js', () => ({
  recordAudit: vi.fn(async () => undefined),
}));
vi.mock('@/infrastructure/http/plugins/authenticate.js', () => ({
  authenticate: vi.fn(async (request: { authUser?: unknown }) => {
    request.authUser = { id: USER, tenantId: USER, role: 'costista' };
  }),
  auditContext: () => ({ ipAddress: '127.0.0.1', userAgent: 'test' }),
  requireRole: () => async () => undefined,
}));

const USER = 'user-1';
const STRUCTURE = '11111111-1111-4111-8111-111111111111';

/** Config de CIF con un solo centro productivo. `bp` es la capacidad normal. */
function configCIF(bp: number) {
  return {
    centers: [{ id: 'prod1', name: 'Corte', type: 'productive' }],
    concepts: [
      { name: 'Alquiler', amount: { fixed: 120000, variable: 80000 }, distribution: { prod1: 1 } },
    ],
    serviceDistributions: [],
    productiveSettings: [
      { centerId: 'prod1', normalCapacity: bp, actualActivity: 900, actualCip: 195000 },
    ],
  };
}

/** MP y MOD mínimas y válidas: lo que se prueba es el CIF. */
const configMP = {
  materials: [
    {
      wilson: { annualDemand: 100, orderCost: 100, holdingRate: 0.3, unitCost: 10 },
      stockPolicy: { minConsumption: 1, maxConsumption: 2, minLeadTime: 1, maxLeadTime: 2, safetyStock: 1 },
      initialStock: { quantity: 10, unitCost: 10 },
      movements: [],
    },
  ],
};
const configMOD = {
  workingDays: {
    totalDaysPerYear: 365,
    unpaidAbsence: { sundays: 52, saturdays: 52, unjustifiedAbsences: 0, holidaysOnWeekend: 0 },
    paidAbsence: { holidays: 0, vacations: 0, sickness: 0, specialLeaves: 0, workAccidents: 0 },
  },
  itcs: { derivationBase: 0.27, fixedArt: 0.015, uncertainRemunerative: [], uncertainNonRemunerative: [] },
  departments: [{ name: 'Depto', basicRemuneration: 1000, hoursWorked: 100 }],
};

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

/** La estructura tal como está guardada (`indirectCostConfig` es el JSONB). */
function structureRow(indirectCostConfig: unknown = null) {
  return {
    id: STRUCTURE,
    userId: USER,
    companyId: 'comp-1',
    productName: 'Mesa',
    costingSystem: 'ORDERS',
    rawMaterialConfig: configMP,
    directLaborConfig: configMOD,
    indirectCostConfig,
    salesUnitPrice: 1000,
    salesQuantity: 10,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.costStructure.findFirst.mockResolvedValue(structureRow());
  db.costStructure.update.mockImplementation(async ({ data }: { data: object }) => ({ id: STRUCTURE, ...data }));
  db.costPeriod.findFirst.mockResolvedValue(null);
  db.costPeriod.update.mockResolvedValue({});
  db.costConfigVersion.findFirst.mockResolvedValue(null);
  db.costConfigVersion.create.mockResolvedValue({});
  db.costCalculation.create.mockResolvedValue({ id: 'calc-1' });
  db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(db));
});

describe('PUT /cost-structures/:id/indirect-costs con capacidad normal en 0', () => {
  it('devuelve 422 (no 200) y nombra el centro, sin exponer el id interno', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'PUT',
      url: `/cost-structures/${STRUCTURE}/indirect-costs`,
      headers: { authorization: 'Bearer t' },
      payload: configCIF(0),
    });

    expect(res.statusCode).toBe(422);
    const body = res.json() as { error: { code: string; message: string; details?: { field?: string } } };
    expect(body.error.code).toBe('MISSING_INPUT');
    expect(body.error.message).toContain('«Corte»');
    expect(body.error.message).toMatch(/capacidad normal/i);
    // El id interno del centro nunca sale en el mensaje (F09-4).
    expect(body.error.message).not.toContain('prod1');
    expect(body.error.details?.field).toContain('normalCapacity');

    // Y no se guardó NADA: ni la estructura, ni la versión append-only.
    expect(db.costStructure.update).not.toHaveBeenCalled();
    expect(db.costConfigVersion.create).not.toHaveBeenCalled();

    await app.close();
  });

  it('con capacidad normal cargada guarda normal (200)', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'PUT',
      url: `/cost-structures/${STRUCTURE}/indirect-costs`,
      headers: { authorization: 'Bearer t' },
      payload: configCIF(1000),
    });

    expect(res.statusCode).toBe(200);
    expect(db.costStructure.update).toHaveBeenCalledTimes(1);

    await app.close();
  });
});

describe('POST /cost-structures/:id/calculate sobre una estructura ya guardada con bp = 0', () => {
  it('devuelve 422 accionable, no el 500 "División por cero en cálculo monetario"', async () => {
    // Ya está en la base: se guardó antes del fix, o lo escribió el poblador
    // automático de documentos (que no pasa por el PUT).
    db.costStructure.findFirst.mockResolvedValue(structureRow(configCIF(0)));

    const app = await buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: `/cost-structures/${STRUCTURE}/calculate`,
      headers: { authorization: 'Bearer t' },
      payload: {},
    });

    expect(res.statusCode).toBe(422);
    const body = res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe('MISSING_INPUT');
    expect(body.error.message).toContain('«Corte»');
    expect(body.error.message).not.toContain('División por cero');
    expect(body.error.message).not.toContain('prod1');

    // No se persistió ningún cálculo con CIF fantasma.
    expect(db.costCalculation.create).not.toHaveBeenCalled();

    await app.close();
  });

  it('la misma estructura con capacidad normal cargada calcula y persiste (200)', async () => {
    db.costStructure.findFirst.mockResolvedValue(structureRow(configCIF(1000)));

    const app = await buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: `/cost-structures/${STRUCTURE}/calculate`,
      headers: { authorization: 'Bearer t' },
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    expect(db.costCalculation.create).toHaveBeenCalledTimes(1);

    await app.close();
  });
});
