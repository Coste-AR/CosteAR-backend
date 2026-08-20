import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Tests de JointCostService (Costeo por Procesos, B16) con Prisma mockeado
 * (mismo patrón que unit-movement-service.test.ts): aíslan la orquestación
 * —repartir con el dominio, persistir, auditar y TRAZAR— sin una base viva. La
 * matemática de los cuatro métodos ya está probada en tests/domain/joint-costs.test.ts;
 * acá se reutilizan los mismos números ANCLA (FX-J1, Clase 24) para verificar el round-trip.
 */

const mockTx = {
  costStructure: { findFirst: vi.fn() },
  processDepartment: { findFirst: vi.fn() },
  costPeriod: { findFirst: vi.fn() },
  jointCostAllocation: { findUnique: vi.fn(), upsert: vi.fn() },
  byProductLine: { deleteMany: vi.fn(), create: vi.fn() },
  dataPoint: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
  dataPointVersion: { create: vi.fn(), findFirst: vi.fn() },
  traceAuditLog: { create: vi.fn() },
};

vi.mock('@/infrastructure/database/prisma.js', () => ({
  prisma: mockTx,
  withTenant: (_userId: string, fn: (tx: typeof mockTx) => unknown) => fn(mockTx),
}));

const actor = { id: 'user-1', role: 'COSTISTA', area: 'planta', device: 'test-agent · 127.0.0.1' };

/** Estructura de Procesos válida, depto. Extracción (punto de separación), período. */
function mockProcessesContext() {
  mockTx.costStructure.findFirst.mockResolvedValue({
    id: 'st-1',
    userId: 'user-1',
    productName: 'Aceite de naranja',
    costingSystem: 'PROCESSES',
  });
  mockTx.processDepartment.findFirst.mockResolvedValue({ id: 'dept-1', name: 'Extracción' });
  mockTx.costPeriod.findFirst.mockResolvedValue({ id: 'per-1', label: 'Abril 2026', code: '2026-04' });
}

/** upsert de la cabecera devuelve la fila persistida. */
function mockUpsertEcho() {
  mockTx.jointCostAllocation.upsert.mockImplementation(
    async (args: { create?: Record<string, unknown>; update?: Record<string, unknown> }) => ({
      id: 'jca-1',
      ...(args.create ?? {}),
      ...(args.update ?? {}),
    }),
  );
}

async function makeService() {
  const { JointCostService } = await import(
    '@/application/cost-structures/process-costing/joint-cost-service.js'
  );
  return new JointCostService(mockTx as never);
}

/** Redondea a `dp` decimales para comparar contra los números impresos de la cátedra. */
const round = (v: number, dp = 2): number => Math.round(v * 10 ** dp) / 10 ** dp;

describe('JointCostService — B16', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTx.dataPoint.create.mockResolvedValue({ id: 'dp-x' });
    mockTx.dataPointVersion.create.mockResolvedValue({ id: 'v1', versionN: 1 });
    mockTx.dataPoint.findFirst.mockResolvedValue(null);
    mockTx.dataPoint.findMany.mockResolvedValue([]);
    mockTx.jointCostAllocation.findUnique.mockResolvedValue(null);
    mockTx.byProductLine.deleteMany.mockResolvedValue({ count: 0 });
    mockTx.byProductLine.create.mockResolvedValue({ id: 'bpl-x' });
  });

  it('save + get: round-trip devuelve el reparto calculado (ancla M1, unidades físicas)', async () => {
    mockProcessesContext();
    mockUpsertEcho();
    const service = await makeService();

    // Ancla M1: costo conjunto $570.000; A 2.500, B 3.000, C 4.000 → $60/kg.
    const saved = await service.save(
      'user-1',
      'st-1',
      'dept-1',
      'per-1',
      {
        deptId: 'dept-1',
        method: 'PHYSICAL_UNITS',
        jointCostTotal: 570000,
        products: [
          { productName: 'A', kind: 'coproduct', unitsObtained: 2500 },
          { productName: 'B', kind: 'coproduct', unitsObtained: 3000 },
          { productName: 'C', kind: 'coproduct', unitsObtained: 4000 },
        ],
        sourceArea: 'planta',
        captureMethod: 'manual',
      },
      actor,
    );

    expect(saved.result.lines.map((l) => l.unitCost)).toEqual([60, 60, 60]);
    expect(saved.result.lines.map((l) => l.allocatedCost)).toEqual([150000, 180000, 240000]);
    expect(saved.result.totalAllocated).toBe(570000);

    // Se persistió una línea por producto con su costo asignado / unitario.
    expect(mockTx.byProductLine.deleteMany).toHaveBeenCalledTimes(1);
    expect(mockTx.byProductLine.create).toHaveBeenCalledTimes(3);

    // Round-trip: get lee la cabecera + las líneas persistidas y las recomputa.
    const createdLines = mockTx.byProductLine.create.mock.calls.map((c) => c[0].data);
    mockTx.jointCostAllocation.findUnique.mockResolvedValue({
      id: 'jca-1',
      method: 'PHYSICAL_UNITS',
      jointCostTotal: 570000,
      products: createdLines,
    });
    const got = await service.get('user-1', 'st-1', 'dept-1', 'per-1');

    expect(got.exists).toBe(true);
    expect(got.result!.lines.map((l) => l.unitCost)).toEqual([60, 60, 60]);
    expect(got.result!.totalAllocated).toBe(570000);
  });

  it('cada DataPoint que crea el reparto nace imputado a su período (H6: si no, traba el cierre)', async () => {
    mockProcessesContext();
    mockUpsertEcho();
    const service = await makeService();

    await service.save(
      'user-1',
      'st-1',
      'dept-1',
      'per-1',
      {
        deptId: 'dept-1',
        method: 'PHYSICAL_UNITS',
        jointCostTotal: 570000,
        products: [{ productName: 'A', kind: 'coproduct', unitsObtained: 2500 }],
        sourceArea: 'planta',
        captureMethod: 'manual',
      },
      actor,
    );

    expect(mockTx.dataPoint.create).toHaveBeenCalled();
    for (const call of mockTx.dataPoint.create.mock.calls) {
      expect(call[0].data.periodoImputado).toBe('2026-04');
    }
  });

  it('los 4 métodos computan correctamente (números ancla FX-J1, Clase 24)', async () => {
    mockProcessesContext();
    mockUpsertEcho();
    const service = await makeService();

    // M2 · factor técnico: rendimientos 6 % / 0,50 % / 5 % → participaciones 52,17/4,35/43,48.
    const m2 = await service.save('user-1', 'st-1', 'dept-1', 'per-1', {
      deptId: 'dept-1',
      method: 'TECHNICAL_YIELD',
      jointCostTotal: 230000,
      products: [
        { productName: 'Jugo', kind: 'coproduct', unitsObtained: 60, yieldPct: 0.06 },
        { productName: 'Aceite', kind: 'coproduct', unitsObtained: 5, yieldPct: 0.005 },
        { productName: 'Cáscara', kind: 'coproduct', unitsObtained: 50, yieldPct: 0.05 },
      ],
      sourceArea: 'planta',
      captureMethod: 'manual',
    }, actor);
    expect(m2.result.lines.map((l) => round(l.participationPct * 100))).toEqual([52.17, 4.35, 43.48]);
    expect(round(m2.result.totalAllocated)).toBe(230000);

    // M3 · valor de mercado: A $100.000 ($40/kg), B $170.000 ($56,67), C $300.000 ($75).
    const m3 = await service.save('user-1', 'st-1', 'dept-1', 'per-1', {
      deptId: 'dept-1',
      method: 'MARKET_VALUE',
      jointCostTotal: 570000,
      products: [
        { productName: 'A', kind: 'coproduct', unitsObtained: 2500, marketPrice: 120 },
        { productName: 'B', kind: 'coproduct', unitsObtained: 3000, marketPrice: 170 },
        { productName: 'C', kind: 'coproduct', unitsObtained: 4000, marketPrice: 225 },
      ],
      sourceArea: 'planta',
      captureMethod: 'manual',
    }, actor);
    expect(m3.result.lines.map((l) => l.allocatedCost)).toEqual([100000, 170000, 300000]);
    expect(m3.result.lines.map((l) => round(l.unitCost))).toEqual([40, 56.67, 75]);

    // M4 · VNR: costos asignados A $17.191,32; B $34.688,54; C $58.120,13 (control $110.000).
    const m4 = await service.save('user-1', 'st-1', 'dept-1', 'per-1', {
      deptId: 'dept-1',
      method: 'NET_REALIZABLE_VALUE',
      jointCostTotal: 110000,
      products: [
        { productName: 'A', kind: 'coproduct', unitsObtained: 200, marketPrice: 300, sellingCostVarPct: 0.03, sellingCostFixedPerUnit: 10 },
        { productName: 'B', kind: 'coproduct', unitsObtained: 300, marketPrice: 400, sellingCostVarPct: 0.03, sellingCostFixedPerUnit: 10 },
        { productName: 'C', kind: 'coproduct', unitsObtained: 400, marketPrice: 500, sellingCostVarPct: 0.03, sellingCostFixedPerUnit: 10 },
      ],
      sourceArea: 'planta',
      captureMethod: 'manual',
    }, actor);
    expect(m4.result.lines.map((l) => round(l.allocatedCost))).toEqual([17191.32, 34688.54, 58120.13]);
    expect(round(m4.result.totalAllocated)).toBe(110000);
  });

  it('FX-J2 (Clase 27): una línea con costo asignado > valor de mercado se MUESTRA con pérdida, no se descarta', async () => {
    mockProcessesContext();
    mockUpsertEcho();
    const service = await makeService();

    // Factor técnico: reparte por RENDIMIENTO e ignora el precio. "Aceite" tiene un
    // rendimiento alto (base 0,50 de 0,56 → ~89 % del costo) pero un valor de mercado
    // bajo, así que su costo asignado supera su valor de venta: pierde.
    const saved = await service.save('user-1', 'st-1', 'dept-1', 'per-1', {
      deptId: 'dept-1',
      method: 'TECHNICAL_YIELD',
      jointCostTotal: 100000,
      products: [
        { productName: 'Jugo', kind: 'coproduct', unitsObtained: 60, yieldPct: 0.06, marketPrice: 2000 },
        { productName: 'Aceite', kind: 'coproduct', unitsObtained: 5, yieldPct: 0.5, marketPrice: 100 },
      ],
      sourceArea: 'planta',
      captureMethod: 'manual',
    }, actor);

    // Las DOS líneas están presentes (ninguna se descartó).
    expect(saved.result.lines).toHaveLength(2);
    const aceite = saved.result.lines.find((l) => l.productName === 'Aceite')!;
    expect(aceite).toBeDefined();
    // Aceite tiene sus números completos y margen NEGATIVO (pérdida marcada).
    expect(aceite.allocatedCost).toBeGreaterThan(aceite.marketValue!);
    expect(aceite.margin).toBeLessThan(0);
    expect(aceite.isLoss).toBe(true);
    // El coproducto rentable NO está marcado como pérdida.
    const jugo = saved.result.lines.find((l) => l.productName === 'Jugo')!;
    expect(jugo.isLoss).toBe(false);
    // El reparto sigue cerrando: Σ asignados = costo conjunto total.
    expect(round(saved.result.totalAllocated)).toBe(100000);
  });

  it('un dataset roto (Σ base = 0) → 422 (ProcessValidationError) nombrando el departamento', async () => {
    mockProcessesContext();
    const service = await makeService();
    const { ProcessValidationError } = await import('@/domain/errors/calculation-errors.js');

    // Valor de mercado con todos los precios en 0 → base de reparto total 0 → no se puede repartir.
    await expect(
      service.save('user-1', 'st-1', 'dept-1', 'per-1', {
        deptId: 'dept-1',
        method: 'MARKET_VALUE',
        jointCostTotal: 570000,
        products: [
          { productName: 'A', kind: 'coproduct', unitsObtained: 2500, marketPrice: 0 },
          { productName: 'B', kind: 'coproduct', unitsObtained: 3000, marketPrice: 0 },
        ],
        sourceArea: 'planta',
        captureMethod: 'manual',
      }, actor),
    ).rejects.toMatchObject({ constructor: ProcessValidationError, statusCode: 422 });

    try {
      await service.save('user-1', 'st-1', 'dept-1', 'per-1', {
        deptId: 'dept-1',
        method: 'MARKET_VALUE',
        jointCostTotal: 570000,
        products: [{ productName: 'A', kind: 'coproduct', unitsObtained: 2500, marketPrice: 0 }],
        sourceArea: 'planta',
        captureMethod: 'manual',
      }, actor);
    } catch (e) {
      expect((e as Error).message).toContain('Extracción');
    }

    // Reparto inválido ⇒ nada se persistió.
    expect(mockTx.jointCostAllocation.upsert).not.toHaveBeenCalled();
  });

  it('cada insumo MANUAL crea un DataPoint (costo total + precio/rendimiento/gastos por línea)', async () => {
    mockProcessesContext();
    mockUpsertEcho();
    const service = await makeService();

    await service.save('user-1', 'st-1', 'dept-1', 'per-1', {
      deptId: 'dept-1',
      method: 'NET_REALIZABLE_VALUE',
      jointCostTotal: 110000,
      products: [
        { productName: 'A', kind: 'coproduct', unitsObtained: 200, marketPrice: 300, sellingCostVarPct: 0.03, sellingCostFixedPerUnit: 10 },
      ],
      sourceArea: 'planta',
      captureMethod: 'manual',
    }, actor);

    // 1 (jointCostTotal) + 5 de la línea A (unitsObtained, marketPrice, sellingCostVarPct,
    // sellingCostFixedPerUnit) — yieldPct no se cargó, así que no se traza.
    const createdKeys = mockTx.dataPoint.create.mock.calls.map((c) =>
      (c[0].data.fieldKey as string).split('.').pop(),
    );
    expect(createdKeys).toContain('jointCostTotal');
    expect(createdKeys).toContain('unitsObtained');
    expect(createdKeys).toContain('marketPrice');
    expect(createdKeys).toContain('sellingCostVarPct');
    expect(createdKeys).toContain('sellingCostFixedPerUnit');
    // yieldPct no se cargó → no se traza; los resultados (allocatedCost/unitCost) tampoco.
    expect(createdKeys).not.toContain('yieldPct');
    expect(createdKeys).not.toContain('allocatedCost');
    expect(createdKeys).not.toContain('unitCost');
    expect(mockTx.dataPoint.create).toHaveBeenCalledTimes(5);
  });

  it('el save escribe una fila de auditoría del reparto en la misma transacción', async () => {
    mockProcessesContext();
    mockUpsertEcho();
    const service = await makeService();

    await service.save('user-1', 'st-1', 'dept-1', 'per-1', {
      deptId: 'dept-1',
      method: 'PHYSICAL_UNITS',
      jointCostTotal: 570000,
      products: [
        { productName: 'A', kind: 'coproduct', unitsObtained: 2500 },
        { productName: 'B', kind: 'coproduct', unitsObtained: 3000 },
        { productName: 'C', kind: 'coproduct', unitsObtained: 4000 },
      ],
      sourceArea: 'planta',
      captureMethod: 'manual',
    }, actor);

    const audit = mockTx.traceAuditLog.create.mock.calls.find(
      (c) => c[0].data.entityType === 'JointCostAllocation',
    );
    expect(audit).toBeDefined();
    expect(audit![0].data.action).toBe('crear');
    expect(mockTx.jointCostAllocation.upsert).toHaveBeenCalledTimes(1);
  });

  it('sobre una estructura de ÓRDENES → 422 accionable (el reparto no aplica)', async () => {
    mockTx.costStructure.findFirst.mockResolvedValue({
      id: 'st-1',
      userId: 'user-1',
      productName: 'Silla de madera',
      costingSystem: 'ORDERS',
    });
    const service = await makeService();
    const { UnprocessableEntityError } = await import('@/domain/errors/domain-error.js');

    await expect(service.get('user-1', 'st-1', 'dept-1', 'per-1')).rejects.toBeInstanceOf(
      UnprocessableEntityError,
    );

    try {
      await service.save('user-1', 'st-1', 'dept-1', 'per-1', {
        deptId: 'dept-1',
        method: 'PHYSICAL_UNITS',
        jointCostTotal: 570000,
        products: [{ productName: 'A', kind: 'coproduct', unitsObtained: 2500 }],
        sourceArea: 'planta',
        captureMethod: 'manual',
      }, actor);
    } catch (e) {
      expect((e as Error).message).toContain('Silla de madera');
      expect((e as Error).message).toContain('Órdenes');
    }
    // No se tocó la base.
    expect(mockTx.jointCostAllocation.upsert).not.toHaveBeenCalled();
  });

  it('get sin reparto cargado devuelve exists=false (sin resultado ni trazas)', async () => {
    mockProcessesContext();
    const service = await makeService();
    mockTx.jointCostAllocation.findUnique.mockResolvedValue(null);

    const got = await service.get('user-1', 'st-1', 'dept-1', 'per-1');
    expect(got.exists).toBe(false);
    expect(got.result).toBeNull();
  });

  it('re-save con el MISMO valor NO crea una versión espuria (append-only sin ruido)', async () => {
    mockProcessesContext();
    mockUpsertEcho();
    const service = await makeService();

    // Ya existe el DataPoint del costo conjunto total con valor 570000 (sin cambios).
    mockTx.dataPoint.findFirst.mockImplementation(async (args: { where: { fieldKey: string } }) => {
      if (args.where.fieldKey.endsWith('jointCostTotal')) {
        return { id: 'dp-total', fechaHecho: null, versions: [{ versionN: 1, valueNum: 570000 }] };
      }
      return null;
    });

    await service.save('user-1', 'st-1', 'dept-1', 'per-1', {
      deptId: 'dept-1',
      method: 'PHYSICAL_UNITS',
      jointCostTotal: 570000,
      products: [{ productName: 'A', kind: 'coproduct', unitsObtained: 2500 }],
      sourceArea: 'planta',
      captureMethod: 'manual',
    }, actor);

    // jointCostTotal no cambió (570000 → 570000): no se versiona.
    expect(mockTx.dataPoint.update).not.toHaveBeenCalled();
    // Solo se crea el DataPoint de unitsObtained (el único insumo nuevo de la línea).
    const createdKeys = mockTx.dataPoint.create.mock.calls.map((c) =>
      (c[0].data.fieldKey as string).split('.').pop(),
    );
    expect(createdKeys).toEqual(['unitsObtained']);
  });
});
