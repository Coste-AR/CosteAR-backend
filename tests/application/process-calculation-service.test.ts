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
    // El camino feliz es el de una estructura ya configurada: sin el setup
    // sellado, calcular Procesos se frena con un 422 accionable.
    setupCompletedAt: new Date('2026-04-01T00:00:00Z'),
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

  it('sin el setup previo completo NO calcula, y lo dice de forma accionable', async () => {
    const { ProcessCalculationService } = await import(
      '@/application/cost-structures/process-costing/process-calculation-service.js'
    );
    primeHappyPath();
    mockTx.costStructure.findFirst.mockResolvedValue({
      id: 'st-1',
      userId: 'user-1',
      productName: 'Alcohol',
      costingSystem: 'PROCESSES',
      setupCompletedAt: null, // nunca declaró su estructura productiva
    });

    const service = new ProcessCalculationService(mockTx as never);
    const promise = service.calculate('user-1', 'st-1', PERIOD, actor);

    // 422 accionable, nunca un 500 ni un número vacío que después alguien lee
    // como si fuera un costo.
    await expect(promise).rejects.toBeInstanceOf(UnprocessableEntityError);
    await expect(promise).rejects.toThrow(/configuración inicial/i);
    expect(mockTx.calculationRun.create).not.toHaveBeenCalled();
  });

  it('sin setup el INFORME igual se puede leer: la compuerta es para emitir, no para mirar', async () => {
    const { ProcessCalculationService } = await import(
      '@/application/cost-structures/process-costing/process-calculation-service.js'
    );
    primeHappyPath();
    mockTx.costStructure.findFirst.mockResolvedValue({
      id: 'st-1',
      userId: 'user-1',
      productName: 'Alcohol',
      costingSystem: 'PROCESSES',
      setupCompletedAt: null,
    });

    const service = new ProcessCalculationService(mockTx as never);

    // Si la compuerta estuviera en el armado del input, una estructura vieja sin
    // setup no podría ni abrir el período siguiente: el arrastre entre períodos
    // usa este informe internamente.
    await expect(service.getProductionReport('user-1', 'st-1', PERIOD)).resolves.toBeDefined();
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

  /**
   * H12 — el factor de conversión declarado en el setup tiene que LLEGAR al
   * motor. La matemática está en `unidades-entre-departamentos-motor.test.ts`;
   * lo que se prueba acá es la cañería: si el servicio no lo pasa, el motor
   * calcula con factor 1 y el costo sale multiplicado por el factor sin avisar.
   */
  it('le pasa al motor el factor de conversión del departamento (H12)', async () => {
    const { ProcessCalculationService } = await import(
      '@/application/cost-structures/process-costing/process-calculation-service.js'
    );
    primeHappyPath();

    // Extracción mide en toneladas, Concentración en litros: 1 t → 500 l.
    mockTx.processDepartment.findMany.mockResolvedValue([
      { id: 'dept-1', name: 'Extracción', sequence: 1, defaultConversionAvanceEqualsMO: true, conversionFromPrevious: null },
      { id: 'dept-2', name: 'Concentración', sequence: 2, defaultConversionAvanceEqualsMO: true, conversionFromPrevious: 500 },
    ]);
    mockTx.unitMovementSchedule.findUnique.mockImplementation(({ where }: never) =>
      Promise.resolve(
        where.departmentId_periodId.departmentId === 'dept-1'
          ? // 8.500 toneladas por $425.000.000 = $50.000 la tonelada.
            { ...scheduleRow, startedInProduction: 8500, transferredOut: 8500, periodCostMp: 340000000, periodCostMo: 85000000 }
          : // Recibe 8.500 × 500 = 4.250.000 litros y no agrega costo propio.
            { ...scheduleRow, startedInProduction: 0, receivedFromPrevious: 4250000, transferredOut: 4250000, periodCostMp: 0, periodCostMo: 0, initialWipCostPrevDept: 0 },
      ),
    );

    const service = new ProcessCalculationService(mockTx as never);
    const report = await service.getProductionReport('user-1', 'st-1', PERIOD);

    // $50.000 la tonelada ÷ 500 = $100 el litro. Sin el factor daría $50.000.
    expect(report.finalUnitCost).toBe(100);
  });
});
