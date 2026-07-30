import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UnprocessableEntityError } from '@/domain/errors/domain-error.js';

/**
 * B17 — SERVICIO DE CÁLCULO POR PROCESOS (borde de aplicación del motor).
 *
 * Cubre lo que el motor puro no puede: la marca de incompletitud (F04), el
 * enlace de las hojas del árbol a sus DataPoints y el rechazo de una estructura
 * de Órdenes. La matemática ya está verificada en `process-costing-engine.test.ts`.
 */

const mockTx = {
  costStructure: { findFirst: vi.fn() },
  costPeriod: { findFirst: vi.fn() },
  processDepartment: { findMany: vi.fn() },
  unitMovementSchedule: { findUnique: vi.fn() },
  jointCostAllocation: { findUnique: vi.fn() },
  dataPoint: { findMany: vi.fn() },
  // Lock de fila que persistCalculationRun toma antes de asignar runN.
  $queryRaw: vi.fn().mockResolvedValue([]),
  calculationRun: { findFirst: vi.fn(), create: vi.fn() },
  calculationNode: { create: vi.fn() },
  traceAuditLog: { create: vi.fn() },
};

vi.mock('@/infrastructure/database/prisma.js', () => ({
  prisma: mockTx,
  withTenant: (_userId: string, fn: (tx: typeof mockTx) => unknown) => fn(mockTx),
}));

const actor = { id: 'user-1', role: 'COSTISTA', area: 'costista' };
const PERIOD = 'per-1';

/** Cuadro de UN departamento inicial lineal (sin EI ni pérdidas): unit $2,00. */
const scheduleRow = {
  initialWip: 0,
  startedInProduction: 1000,
  receivedFromPrevious: 0,
  unitIncrease: 0,
  transferredOut: 1000,
  finishedInStock: 0,
  normalLossPct: 0,
  normalLoss: 0,
  totalLossReported: 0,
  extraordinaryLoss: 0,
  finalWip: 0,
  finalWipMpAvance: 1,
  finalWipConvAvance: 1,
  periodCostMp: 1000,
  periodCostMo: 1000,
  periodCostCif: 0,
  initialWipCostMp: 0,
  initialWipCostMo: 0,
  initialWipCostCif: 0,
};

function primeHappyPath() {
  mockTx.costStructure.findFirst.mockResolvedValue({
    id: 'st-1',
    userId: 'user-1',
    productName: 'Alcohol',
    costingSystem: 'PROCESSES',
  });
  mockTx.costPeriod.findFirst.mockResolvedValue({ id: PERIOD, structureId: 'st-1', label: 'Abril 2026' });
  mockTx.processDepartment.findMany.mockResolvedValue([
    { id: 'dept-1', name: 'Destilado', sequence: 1, defaultConversionAvanceEqualsMO: true },
  ]);
  mockTx.unitMovementSchedule.findUnique.mockResolvedValue(scheduleRow);
  mockTx.jointCostAllocation.findUnique.mockResolvedValue(null);
  mockTx.calculationRun.findFirst.mockResolvedValue(null); // runN → 1
  mockTx.calculationRun.create.mockResolvedValue({ id: 'run-1', runN: 1 });
  mockTx.calculationNode.create.mockResolvedValue({ id: 'node-x' });
  mockTx.traceAuditLog.create.mockResolvedValue({});
}

describe('ProcessCalculationService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('marca el resultado como INCOMPLETO cuando hay datos sin imputar (F04)', async () => {
    const { ProcessCalculationService } = await import(
      '@/application/cost-structures/process-costing/process-calculation-service.js'
    );
    primeHappyPath();
    // 1ª llamada a dataPoint.findMany = pendientes de imputación (no vacío);
    // 2ª = attachDataPointSources (sin matches).
    mockTx.dataPoint.findMany
      .mockResolvedValueOnce([{ id: 'dp-9', label: 'Compra de melaza' }])
      .mockResolvedValueOnce([]);

    const service = new ProcessCalculationService(mockTx as never);
    const result = await service.calculate('user-1', 'st-1', PERIOD, actor);

    expect(result.results.incompletitud.incompleto).toBe(true);
    expect(result.results.incompletitud.datosPendientes).toEqual([{ id: 'dp-9', nombre: 'Compra de melaza' }]);
    // Igual persiste la corrida (marcada), como en Órdenes.
    expect(mockTx.calculationRun.create).toHaveBeenCalledTimes(1);
  });

  it('enlaza las hojas del árbol a su DataPoint por traceFieldKey', async () => {
    const { ProcessCalculationService } = await import(
      '@/application/cost-structures/process-costing/process-calculation-service.js'
    );
    primeHappyPath();
    mockTx.dataPoint.findMany
      .mockResolvedValueOnce([]) // sin pendientes → resultado confiable
      .mockResolvedValueOnce([
        { id: 'dp-transf', fieldKey: `proceso.cuadro.${PERIOD}.dept-1.transferredOut` },
      ]);

    const service = new ProcessCalculationService(mockTx as never);
    const result = await service.calculate('user-1', 'st-1', PERIOD, actor);

    expect(result.results.incompletitud.incompleto).toBe(false);
    // El nodo persistido de "Terminadas y transferidas" (unidades) llevó el DataPoint.
    const linked = mockTx.calculationNode.create.mock.calls.find(
      (c) => c[0].data.sourceDpVersionIds.includes('dp-transf'),
    );
    expect(linked).toBeDefined();
  });

  it('rechaza con 422 accionable una estructura de ÓRDENES (no cae en el motor de Procesos)', async () => {
    const { ProcessCalculationService } = await import(
      '@/application/cost-structures/process-costing/process-calculation-service.js'
    );
    mockTx.costStructure.findFirst.mockResolvedValue({
      id: 'st-1',
      userId: 'user-1',
      productName: 'Alcohol',
      costingSystem: 'ORDERS',
    });

    const service = new ProcessCalculationService(mockTx as never);
    const promise = service.calculate('user-1', 'st-1', PERIOD, actor);
    await expect(promise).rejects.toBeInstanceOf(UnprocessableEntityError);
    await expect(promise).rejects.toThrow(/Costeo por Órdenes/i);
    expect(mockTx.calculationRun.create).not.toHaveBeenCalled();
  });

  it('el informe de producción recalcula sin persistir (no crea corrida)', async () => {
    const { ProcessCalculationService } = await import(
      '@/application/cost-structures/process-costing/process-calculation-service.js'
    );
    primeHappyPath();

    const service = new ProcessCalculationService(mockTx as never);
    const report = await service.getProductionReport('user-1', 'st-1', PERIOD);

    expect(report.finalUnitCost).toBe(2);
    expect(report.departments).toHaveLength(1);
    expect(report.departments[0]!.report.costoUnitarioTotalAcumulado).toBe(2);
    expect(mockTx.calculationRun.create).not.toHaveBeenCalled();
  });
});
