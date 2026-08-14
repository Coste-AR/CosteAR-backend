import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * UNA FICHA DE STOCK QUE NO CUADRA NO ES UN 500.
 *
 * El control de consistencia de materia prima que pide la cátedra —existencia
 * inicial + compras − consumos >= 0— vive en `calcStockLedgerPPP`. Estaba bien
 * que existiera y mal cómo salía: se tiraba un `Error` pelado, y el handler
 * central manda cualquier cosa que no sea `DomainError`/`ZodError` a un 500
 * `INTERNAL_ERROR` con "Error interno del servidor".
 *
 * Resultado en la pantalla del costista: cargaba un consumo de 2000 kg contra un
 * saldo de 1200, apretaba Calcular, y el sistema le decía que se había roto. El
 * mensaje que le decía exactamente qué corregir —con los dos números adentro—
 * se perdía en el log del servidor.
 *
 * Estos tests fijan el contrato HTTP: 422, y el mensaje en castellano con los
 * números intactos llega al body de la respuesta.
 */

const mockDb = {
  costStructure: { findFirst: vi.fn() },
  costCalculation: { create: vi.fn() },
  auditLog: { create: vi.fn() },
  $transaction: vi.fn(),
};

vi.mock('@/infrastructure/database/prisma.js', () => ({
  prisma: mockDb,
  withTenant: (_u: string, fn: (tx: unknown) => unknown) => fn(mockDb),
}));

vi.mock('@/infrastructure/http/plugins/authenticate.js', () => ({
  authenticate: async (request: { authUser?: unknown }) => {
    request.authUser = { id: 'user-1', tenantId: 'tenant-1', role: 'COSTISTA' };
  },
  requireRole: () => async () => {},
  auditContext: () => ({ ipAddress: '1.1.1.1', userAgent: 'test' }),
}));

const STRUCTURE_ID = '11111111-1111-4111-8111-111111111111';

/** App mínima: las rutas reales + el handler de errores real. Nada más. */
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

async function calculate() {
  const app = await buildTestApp();
  const res = await app.inject({
    method: 'POST',
    url: `/cost-structures/${STRUCTURE_ID}/calculate`,
    headers: { authorization: 'Bearer test-token' },
    payload: {},
  });
  await app.close();
  return res;
}

/** MOD y CIP válidos: lo que se rompe en estos casos es la Hoja 1. */
const directLaborConfig = {
  workingDays: {
    totalDaysPerYear: 365,
    unpaidAbsence: { sundays: 52, saturdays: 52, unjustifiedAbsences: 0, holidaysOnWeekend: 0 },
    paidAbsence: { holidays: 15, vacations: 14, sickness: 0, specialLeaves: 0, workAccidents: 0 },
  },
  itcs: {
    derivationBase: 0.27,
    fixedArt: 0.015,
    uncertainRemunerative: [],
    uncertainNonRemunerative: [],
  },
  departments: [{ name: 'Corte', basicRemuneration: 800000, hoursWorked: 160 }],
};

const indirectCostConfig = {
  centers: [{ id: 'corte', name: 'Corte', type: 'productive' }],
  concepts: [
    { name: 'Alquiler', amount: { fixed: 300000, variable: 0 }, distribution: { corte: 100 } },
  ],
  serviceDistributions: [],
  productiveSettings: [
    { centerId: 'corte', normalCapacity: 160, actualActivity: 160, actualCip: 300000 },
  ],
};

function structureWithMovements(movements: unknown[]) {
  return {
    id: STRUCTURE_ID,
    userId: 'user-1',
    productName: 'Alcohol en gel',
    costingSystem: 'ORDERS',
    rawMaterialConfig: {
      materials: [
        {
          name: 'Alcohol etílico',
          code: 'MP-001',
          unit: 'kg',
          wilson: { annualDemand: 24000, orderCost: 3500, holdingRate: 0.3, unitCost: 800 },
          stockPolicy: {
            minConsumption: 40,
            maxConsumption: 90,
            minLeadTime: 8,
            maxLeadTime: 12,
            safetyStock: 200,
          },
          initialStock: { quantity: 1200, unitCost: 800 },
          movements,
        },
      ],
    },
    directLaborConfig,
    indirectCostConfig,
    salesUnitPrice: 25000,
    salesQuantity: 100,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('POST /cost-structures/:id/calculate — invariantes de materia prima', () => {
  it('consumo 2000 contra un saldo de 1200: 422, no 500', async () => {
    mockDb.costStructure.findFirst.mockResolvedValue(
      structureWithMovements([
        { date: '15/05', type: 'consumption', detail: 'Orden Prod. 01', quantity: 2000 },
      ]),
    );

    const res = await calculate();

    expect(res.statusCode).toBe(422);
    const { error } = res.json();
    expect(error.code).not.toBe('INTERNAL_ERROR');
    expect(error.code).toBe('CALC_ERROR');
  });

  it('el mensaje llega entero al body, con los dos números adentro', async () => {
    mockDb.costStructure.findFirst.mockResolvedValue(
      structureWithMovements([
        { date: '15/05', type: 'consumption', detail: 'Orden Prod. 01', quantity: 2000 },
      ]),
    );

    const res = await calculate();
    const { error } = res.json();

    // El mensaje ES el valor: sin los números el costista no sabe por cuánto se
    // pasó ni contra qué saldo.
    expect(error.message).toBe(
      'Consumo "Orden Prod. 01" (2000) supera el saldo disponible (1200)',
    );
    expect(error.message).not.toMatch(/Error interno del servidor/);
  });

  it('nada se persiste cuando la ficha no cuadra', async () => {
    mockDb.costStructure.findFirst.mockResolvedValue(
      structureWithMovements([
        { date: '15/05', type: 'consumption', detail: 'Orden Prod. 01', quantity: 2000 },
      ]),
    );

    await calculate();

    expect(mockDb.$transaction).not.toHaveBeenCalled();
    expect(mockDb.costCalculation.create).not.toHaveBeenCalled();
  });

  it('compra sin costo unitario: 422 con el nombre de la factura en el mensaje', async () => {
    mockDb.costStructure.findFirst.mockResolvedValue(
      structureWithMovements([
        // El schema deja pasar `unitCost` ausente (es opcional para las compras
        // legadas), así que este dato incompleto llega vivo hasta el motor.
        { date: '02/05', type: 'purchase', detail: 'Factura A-101', quantity: 500 },
      ]),
    );

    const res = await calculate();

    expect(res.statusCode).toBe(422);
    const { error } = res.json();
    expect(error.code).toBe('CALC_ERROR');
    expect(error.message).toBe('Compra "Factura A-101" sin costo unitario');
  });

  it('una ficha que sí cuadra sigue calculando y guardando', async () => {
    mockDb.costStructure.findFirst.mockResolvedValue(
      structureWithMovements([
        { date: '02/05', type: 'purchase', detail: 'Factura A-101', quantity: 500, unitCost: 850 },
        { date: '15/05', type: 'consumption', detail: 'Orden Prod. 01', quantity: 400 },
      ]),
    );
    mockDb.costCalculation.create.mockResolvedValue({ id: 'calc-1' });
    mockDb.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(mockDb));

    const res = await calculate();

    expect(res.statusCode).toBe(200);
    expect(res.json().data.calculationId).toBe('calc-1');
  });

  /**
   * La contracara: el fallback del handler NO se tocó. Un error que no es de
   * dominio sigue saliendo como 500 genérico, sin filtrar el mensaje interno.
   */
  it('un error inesperado sigue siendo un 500 genérico', async () => {
    mockDb.costStructure.findFirst.mockRejectedValue(new Error('connection terminated'));

    const res = await calculate();

    expect(res.statusCode).toBe(500);
    const { error } = res.json();
    expect(error.code).toBe('INTERNAL_ERROR');
    expect(error.message).toBe('Error interno del servidor');
    expect(JSON.stringify(error)).not.toMatch(/connection terminated/);
  });
});
