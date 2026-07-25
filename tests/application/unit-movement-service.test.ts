import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Tests de UnitMovementService (Costeo por Procesos, B15) con Prisma mockeado
 * (mismo patrón que tests/application/data-point-service.test.ts): aíslan la
 * orquestación —validar con el dominio, persistir, auditar y TRAZAR— sin una
 * base viva. La matemática pura ya está probada en tests/domain/process-costing.test.ts.
 */

const mockTx = {
  costStructure: { findFirst: vi.fn() },
  processDepartment: { findFirst: vi.fn() },
  costPeriod: { findFirst: vi.fn() },
  unitMovementSchedule: { findUnique: vi.fn(), upsert: vi.fn() },
  dataPoint: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
  dataPointVersion: { create: vi.fn(), findFirst: vi.fn() },
  traceAuditLog: { create: vi.fn() },
};

vi.mock('@/infrastructure/database/prisma.js', () => ({
  prisma: mockTx,
  withTenant: (_userId: string, fn: (tx: typeof mockTx) => unknown) => fn(mockTx),
}));

const actor = { id: 'user-1', role: 'COSTISTA', area: 'planta', device: 'test-agent · 127.0.0.1' };

/** Estructura de Procesos válida, depto. Destilado (seq 1), período Abril 2026. */
function mockProcessesContext(overrides: { sequence?: number; unified?: boolean } = {}) {
  mockTx.costStructure.findFirst.mockResolvedValue({
    id: 'st-1',
    userId: 'user-1',
    productName: 'Alcohol Fino',
    costingSystem: 'PROCESSES',
  });
  mockTx.processDepartment.findFirst.mockResolvedValue({
    id: 'dept-1',
    name: 'Destilado',
    sequence: overrides.sequence ?? 1,
    defaultConversionAvanceEqualsMO: overrides.unified ?? true,
  });
  mockTx.costPeriod.findFirst.mockResolvedValue({ id: 'per-1', label: 'Abril 2026' });
}

/** upsert devuelve la fila que se "persistió" (los datos de `create`). */
function mockUpsertEcho() {
  mockTx.unitMovementSchedule.upsert.mockImplementation(
    async (args: { create: Record<string, unknown> }) => ({ id: 'sch-1', ...args.create }),
  );
}

async function makeService() {
  const { UnitMovementService } = await import(
    '@/application/cost-structures/process-costing/unit-movement-service.js'
  );
  return new UnitMovementService(mockTx as never);
}

describe('UnitMovementService — B15', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTx.dataPoint.create.mockResolvedValue({ id: 'dp-x' });
    mockTx.dataPointVersion.create.mockResolvedValue({ id: 'v1', versionN: 1 });
    mockTx.dataPoint.findFirst.mockResolvedValue(null);
    mockTx.dataPoint.findMany.mockResolvedValue([]);
    mockTx.unitMovementSchedule.findUnique.mockResolvedValue(null);
  });

  it('save + get: el cuadro vuelve resuelto y cuadra (la EF se deriva por diferencia)', async () => {
    mockProcessesContext();
    mockUpsertEcho();
    const service = await makeService();

    // Depto. inicial: se conoce transferredOut, la EF (finalWip) se deriva.
    const saved = await service.save(
      'user-1',
      'st-1',
      'dept-1',
      'per-1',
      {
        initialWip: 1000,
        startedInProduction: 9000,
        transferredOut: 8000,
        normalLossPct: 0.05, // 5 % × 9000 = 450
        sourceArea: 'planta',
        method: 'manual',
      },
      actor,
    );

    expect(saved.resolved.cuadra).toBe(true);
    expect(saved.resolved.finalWip).toBe(1550); // 10000 − 8000 − 450
    expect(saved.resolved.transferredOut).toBe(8000);
    expect(saved.resolved.totalToAccount).toBe(saved.resolved.totalAccounted);

    // Round-trip: get sobre la fila persistida devuelve lo mismo, resuelto.
    const persistedRow = mockTx.unitMovementSchedule.upsert.mock.calls[0]![0].create;
    mockTx.unitMovementSchedule.findUnique.mockResolvedValue({ id: 'sch-1', ...persistedRow });
    const got = await service.get('user-1', 'st-1', 'dept-1', 'per-1');

    expect(got.exists).toBe(true);
    expect(got.resolved!.cuadra).toBe(true);
    expect(got.resolved!.finalWip).toBe(1550);
    expect(got.resolved!.transferredOut).toBe(8000);
  });

  it('un cuadro que no cuadra → 422 (ProcessValidationError) nombrando el departamento', async () => {
    mockProcessesContext();
    const service = await makeService();
    const { ProcessValidationError } = await import('@/domain/errors/calculation-errors.js');

    // total a justificar 10000; total justificado 8000 + 3000 = 11000 → no cuadra.
    await expect(
      service.save(
        'user-1',
        'st-1',
        'dept-1',
        'per-1',
        {
          initialWip: 1000,
          startedInProduction: 9000,
          transferredOut: 8000,
          finalWip: 3000,
          sourceArea: 'planta',
          method: 'manual',
        },
        actor,
      ),
    ).rejects.toMatchObject({
      constructor: ProcessValidationError,
      statusCode: 422,
    });

    try {
      await service.save(
        'user-1',
        'st-1',
        'dept-1',
        'per-1',
        { initialWip: 1000, startedInProduction: 9000, transferredOut: 8000, finalWip: 3000, sourceArea: 'planta', method: 'manual' },
        actor,
      );
    } catch (e) {
      expect((e as Error).message).toContain('Destilado');
      expect((e as Error).message.toLowerCase()).toContain('no cuadra');
    }

    // No cuadra ⇒ nada se persistió.
    expect(mockTx.unitMovementSchedule.upsert).not.toHaveBeenCalled();
  });

  it('cada valor MANUAL crea un DataPoint; el derivado por diferencia NO', async () => {
    mockProcessesContext();
    mockUpsertEcho();
    const service = await makeService();

    await service.save(
      'user-1',
      'st-1',
      'dept-1',
      'per-1',
      {
        // 4 valores manuales; finishedInStock se omite y finalWip se DERIVA.
        initialWip: 1000,
        startedInProduction: 9000,
        transferredOut: 8000,
        normalLossPct: 0.05,
        sourceArea: 'planta',
        method: 'manual',
      },
      actor,
    );

    // Un DataPoint por cada valor manual (createInTx → dataPoint.create).
    expect(mockTx.dataPoint.create).toHaveBeenCalledTimes(4);

    const createdFields = mockTx.dataPoint.create.mock.calls.map((c) =>
      (c[0].data.fieldKey as string).split('.').pop(),
    );
    expect(new Set(createdFields)).toEqual(
      new Set(['initialWip', 'startedInProduction', 'transferredOut', 'normalLossPct']),
    );
    // El valor derivado por diferencia NO se traza.
    expect(createdFields).not.toContain('finalWip');
  });

  it('cada save escribe una fila de auditoría del cuadro en la misma transacción', async () => {
    mockProcessesContext();
    mockUpsertEcho();
    const service = await makeService();

    await service.save(
      'user-1',
      'st-1',
      'dept-1',
      'per-1',
      { initialWip: 1000, startedInProduction: 9000, transferredOut: 8000, normalLossPct: 0.05, sourceArea: 'planta', method: 'manual' },
      actor,
    );

    const scheduleAudit = mockTx.traceAuditLog.create.mock.calls.find(
      (c) => c[0].data.entityType === 'UnitMovementSchedule',
    );
    expect(scheduleAudit).toBeDefined();
    expect(scheduleAudit![0].data.action).toBe('crear');
    // La auditoría se escribe con el mismo cliente de transacción que el upsert.
    expect(mockTx.unitMovementSchedule.upsert).toHaveBeenCalledTimes(1);
  });

  it('equivalent-production devuelve el resultado B07 del cuadro guardado', async () => {
    mockProcessesContext({ unified: true });
    const service = await makeService();

    // Fila persistida (cuadra): transferidas 8000, EF 1550, avance MP 100 % / Conv 50 %.
    mockTx.unitMovementSchedule.findUnique.mockResolvedValue({
      id: 'sch-1',
      initialWip: 1000,
      startedInProduction: 9000,
      receivedFromPrevious: null,
      unitIncrease: null,
      transferredOut: 8000,
      finishedInStock: 0,
      normalLossPct: 0.05,
      normalLoss: 450,
      totalLossReported: null,
      extraordinaryLoss: 0,
      finalWip: 1550,
      finalWipMpAvance: 1,
      finalWipConvAvance: 0.5,
    });

    const pe = await service.getEquivalentProduction('user-1', 'st-1', 'dept-1', 'per-1');

    expect(pe.unitsAtFullCompletion).toBe(8000);
    const mp = pe.columns.find((c) => c.element === 'MP')!;
    const cc = pe.columns.find((c) => c.element === 'CC')!;
    expect(mp.equivalentUnits).toBe(9550); // 8000 + 1550 × 1
    expect(cc.equivalentUnits).toBe(8775); // 8000 + 1550 × 0,5
  });

  it('equivalent-production sin cuadro cargado → 422 accionable nombrando el departamento', async () => {
    mockProcessesContext();
    const service = await makeService();
    mockTx.unitMovementSchedule.findUnique.mockResolvedValue(null);

    await expect(
      service.getEquivalentProduction('user-1', 'st-1', 'dept-1', 'per-1'),
    ).rejects.toMatchObject({ statusCode: 422 });
  });

  it('sobre una estructura de ÓRDENES → 422 accionable (el cuadro no aplica)', async () => {
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
      await service.getEquivalentProduction('user-1', 'st-1', 'dept-1', 'per-1');
    } catch (e) {
      expect((e as Error).message).toContain('Silla de madera');
      expect((e as Error).message).toContain('Órdenes');
    }
  });

  it('re-save con el MISMO valor NO crea una versión espuria (append-only sin ruido)', async () => {
    mockProcessesContext();
    mockUpsertEcho();
    const service = await makeService();

    // Ya existe el DataPoint de `startedInProduction` con valor 9000 (sin cambios).
    mockTx.dataPoint.findFirst.mockImplementation(async (args: { where: { fieldKey: string } }) => {
      if (args.where.fieldKey.endsWith('startedInProduction')) {
        return { id: 'dp-started', fechaHecho: null, versions: [{ versionN: 1, valueNum: 9000 }] };
      }
      return null;
    });

    await service.save(
      'user-1',
      'st-1',
      'dept-1',
      'per-1',
      { initialWip: 1000, startedInProduction: 9000, transferredOut: 8000, normalLossPct: 0.05, sourceArea: 'planta', method: 'manual' },
      actor,
    );

    // startedInProduction no cambió (9000 → 9000): no se versiona (addVersion nunca corre).
    expect(mockTx.dataPoint.update).not.toHaveBeenCalled();
    // Los otros 3 valores (nuevos) sí se crean como DataPoint.
    expect(mockTx.dataPoint.create).toHaveBeenCalledTimes(3);
  });

  it('re-save con un valor DISTINTO versiona el dato existente (no crea uno nuevo)', async () => {
    mockProcessesContext();
    mockUpsertEcho();
    const service = await makeService();

    // Ya existe el DataPoint de `startedInProduction` con valor 9000; ahora entra 9500.
    mockTx.dataPoint.findFirst.mockImplementation(async (args: { where: { fieldKey: string } }) => {
      if (args.where.fieldKey.endsWith('startedInProduction')) {
        return { id: 'dp-started', fechaHecho: null, versions: [{ versionN: 1, valueNum: 9000 }] };
      }
      return null;
    });
    mockTx.dataPointVersion.findFirst.mockResolvedValue({ versionN: 1, valueNum: 9000 });
    mockTx.dataPoint.update.mockResolvedValue({ id: 'dp-started', status: 'borrador' });

    await service.save(
      'user-1',
      'st-1',
      'dept-1',
      'per-1',
      // total 1500 + 9500 = 11000; transferido 10000 → EF derivada 550 (cuadra).
      { initialWip: 1500, startedInProduction: 9500, transferredOut: 10000, normalLossPct: 0.05, sourceArea: 'contaduria', method: 'manual' },
      actor,
    );

    // startedInProduction cambió (9000 → 9500): se agrega la versión 2 sobre el mismo dato.
    const startedVersion = mockTx.dataPointVersion.create.mock.calls.find(
      (c) => c[0].data.dataPointId === 'dp-started',
    );
    expect(startedVersion).toBeDefined();
    expect(startedVersion![0].data.versionN).toBe(2);
    // Y NO se crea un DataPoint nuevo para ese campo (los 3 creates son los otros).
    const createdFields = mockTx.dataPoint.create.mock.calls.map((c) =>
      (c[0].data.fieldKey as string).split('.').pop(),
    );
    expect(createdFields).not.toContain('startedInProduction');
  });
});
