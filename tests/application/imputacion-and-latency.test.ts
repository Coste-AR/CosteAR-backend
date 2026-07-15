import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * F4 — Doble período: un dato sin decisión de imputación NO entra al cálculo
 * (bloquea con 422, no lo ignora silenciosamente), y la latencia de
 * captación se calcula por área.
 */

const mockTx = {
  costStructure: { findFirst: vi.fn() },
  dataPoint: { findMany: vi.fn(), findFirst: vi.fn() },
  calculationRun: { findFirst: vi.fn(), create: vi.fn() },
  calculationNode: { create: vi.fn().mockResolvedValue({ id: 'node-1' }) },
  traceAuditLog: { create: vi.fn(), count: vi.fn(), findMany: vi.fn() },
};

vi.mock('@/infrastructure/database/prisma.js', () => ({
  prisma: mockTx,
  withTenant: (_userId: string, fn: (tx: typeof mockTx) => unknown) => fn(mockTx),
}));

const actor = { id: 'user-1', role: 'COSTISTA', area: 'costista' };

describe('CalculationRunService — dato sin imputar bloquea el cálculo', () => {
  beforeEach(() => vi.clearAllMocks());

  it('tira MissingInputError (422) si hay data points sin periodoImputado', async () => {
    const { CalculationRunService } = await import('@/application/cost-structures/calculation-run-service.js');
    const { MissingInputError } = await import('@/domain/errors/calculation-errors.js');
    const service = new CalculationRunService(mockTx as never);

    mockTx.costStructure.findFirst.mockResolvedValue({
      id: 'st-1',
      userId: 'user-1',
      rawMaterialConfig: {},
      directLaborConfig: {},
      indirectCostConfig: {},
      salesUnitPrice: 100,
      salesQuantity: 10,
    });
    mockTx.dataPoint.findMany.mockResolvedValue([{ id: 'dp-1', label: 'Compra sin imputar' }]);

    await expect(service.calculate('user-1', 'st-1', actor)).rejects.toBeInstanceOf(MissingInputError);
    await expect(service.calculate('user-1', 'st-1', actor)).rejects.toMatchObject({ statusCode: 422 });
  });

  it('no bloquea si no hay data points pendientes de imputación', async () => {
    const { CalculationRunService } = await import('@/application/cost-structures/calculation-run-service.js');
    const service = new CalculationRunService(mockTx as never);

    mockTx.costStructure.findFirst.mockResolvedValue({
      id: 'st-1',
      userId: 'user-1',
      rawMaterialConfig: {
        wilson: { annualDemand: 100, orderCost: 10, holdingRate: 0.3, unitCost: 5 },
        stockPolicy: { minConsumption: 1, maxConsumption: 2, minLeadTime: 1, maxLeadTime: 2, safetyStock: 1 },
        initialStock: { quantity: 10, unitCost: 5 },
        movements: [],
      },
      directLaborConfig: {
        workingDays: {
          totalDaysPerYear: 365,
          unpaidAbsence: { sundays: 0, saturdays: 0, unjustifiedAbsences: 0, holidaysOnWeekend: 0 },
          paidAbsence: { holidays: 0, vacations: 0, sickness: 0, specialLeaves: 0, workAccidents: 0 },
        },
        itcs: { derivationBase: 0.27, fixedArt: 0.015, uncertainRemunerative: [], uncertainNonRemunerative: [] },
        departments: [{ name: 'D', basicRemuneration: 1000, hoursWorked: 10 }],
      },
      indirectCostConfig: {
        centers: [{ id: 'c1', name: 'C1', type: 'productive' }],
        concepts: [{ name: 'X', amount: { fixed: 10, variable: 0 }, distribution: { c1: 1 } }],
        serviceDistributions: [],
        productiveSettings: [{ centerId: 'c1', normalCapacity: 10, actualActivity: 10, actualCip: 10 }],
      },
      salesUnitPrice: 100,
      salesQuantity: 10,
    });
    mockTx.dataPoint.findMany.mockResolvedValue([]); // sin pendientes
    mockTx.calculationRun.findFirst.mockResolvedValue(null);
    mockTx.calculationRun.create.mockResolvedValue({ id: 'run-1', runN: 1 });

    const result = await service.calculate('user-1', 'st-1', actor);
    expect(result.run.runN).toBe(1);
    expect(mockTx.traceAuditLog.create).toHaveBeenCalled();
  });
});

describe('DataPointService.getAudit — latencia de captación por área', () => {
  beforeEach(() => vi.clearAllMocks());

  it('promedia fechaCaptacion - fechaHecho en días, agrupado por sourceArea', async () => {
    const { DataPointService } = await import('@/application/trazabilidad/data-point-service.js');
    const db = {
      costStructure: { findFirst: vi.fn().mockResolvedValue({ id: 'st-1', userId: 'user-1' }) },
      dataPoint: {
        findMany: vi.fn().mockImplementation(({ select }: { select?: Record<string, boolean> }) => {
          if (select) {
            return Promise.resolve([
              { sourceArea: 'deposito', fechaHecho: new Date('2026-06-01'), fechaCaptacion: new Date('2026-06-03') },
              { sourceArea: 'deposito', fechaHecho: new Date('2026-06-05'), fechaCaptacion: new Date('2026-06-06') },
              { sourceArea: 'contaduria', fechaHecho: new Date('2026-06-01'), fechaCaptacion: new Date('2026-06-11') },
            ]);
          }
          return Promise.resolve([]);
        }),
      },
      calculationRun: { findMany: vi.fn().mockResolvedValue([]) },
      traceAuditLog: { count: vi.fn().mockResolvedValue(0), findMany: vi.fn().mockResolvedValue([]) },
    };
    const service = new DataPointService(db as never);

    const audit = await service.getAudit('user-1', 'st-1', 1, 50);

    const deposito = audit.latencyByArea.find((a) => a.area === 'deposito')!;
    const contaduria = audit.latencyByArea.find((a) => a.area === 'contaduria')!;
    expect(deposito.avgDays).toBe(1.5); // (2 + 1) / 2
    expect(deposito.count).toBe(2);
    expect(contaduria.avgDays).toBe(10);
  });
});
