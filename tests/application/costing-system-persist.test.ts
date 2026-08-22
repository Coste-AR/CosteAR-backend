import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CostStructureService } from '@/application/cost-structures/cost-structure-service.js';
import { UnprocessableEntityError } from '@/domain/errors/domain-error.js';

vi.mock('@/application/audit/audit-logger.js', () => ({
  recordAudit: vi.fn(async () => undefined),
}));

/**
 * B01 — EL SISTEMA DE COSTEO (ÓRDENES / PROCESOS) SE PERSISTE.
 *
 * Es la compuerta de toda la feature de Costeo por Procesos: la columna
 * `costingSystem` y el schema de alta ya existían, pero `create()` descartaba el
 * dato y TODA estructura nacía como ORDERS, ignorando lo que mandaba el cliente.
 * Y una vez que la estructura tiene cálculos, cambiar de sistema mezclaría el
 * rastro de dos motores y corrompería el árbol de derivación → 422 accionable.
 */

const USER = 'user-1';
const COMPANY = 'comp-1';
const STRUCT = 'struct-1';
const ctx = { ipAddress: '127.0.0.1', userAgent: 'test' } as never;

/** DB mínima para el ALTA de una estructura. */
function makeCreateDb() {
  const db: Record<string, unknown> = {
    company: {
      findFirst: vi.fn(async () => ({ id: COMPANY, userId: USER, periodicity: 'MONTHLY', isActive: true })),
    },
    costStructure: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: STRUCT, ...data })),
    },
  };
  db.$transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn(db));
  return db as {
    company: { findFirst: ReturnType<typeof vi.fn> };
    costStructure: { create: ReturnType<typeof vi.fn> };
    $transaction: ReturnType<typeof vi.fn>;
  };
}

/** El sistema de costeo con el que quedó guardada la estructura recién creada. */
function sistemaGuardado(db: ReturnType<typeof makeCreateDb>): string {
  const call = db.costStructure.create.mock.calls[0]![0] as { data: { costingSystem: string } };
  return call.data.costingSystem;
}

/**
 * DB mínima para CAMBIAR el sistema de costeo. `runCount`/`calcCount` simulan si
 * la estructura ya tiene historia de cálculo (trazable o legada).
 */
function makeUpdateDb(runCount = 0, calcCount = 0) {
  const db: Record<string, unknown> = {
    costStructure: {
      findFirst: vi.fn(async () => ({ id: STRUCT, userId: USER, costingSystem: 'ORDERS' })),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: STRUCT, ...data })),
    },
    calculationRun: { count: vi.fn(async () => runCount) },
    costCalculation: { count: vi.fn(async () => calcCount) },
  };
  db.$transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn(db));
  return db as {
    costStructure: { findFirst: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
    calculationRun: { count: ReturnType<typeof vi.fn> };
    costCalculation: { count: ReturnType<typeof vi.fn> };
    $transaction: ReturnType<typeof vi.fn>;
  };
}

describe('B01 — el sistema de costeo se persiste al crear la estructura', () => {
  beforeEach(() => vi.clearAllMocks());

  it('🔑 crear con costingSystem PROCESSES lo persiste (antes se caía silenciosamente a ORDERS)', async () => {
    const db = makeCreateDb();
    await new CostStructureService(db as never).create(
      USER, COMPANY, { productName: 'Mesa', costingSystem: 'PROCESSES' }, ctx,
    );
    expect(sistemaGuardado(db)).toBe('PROCESSES');
  });

  it('crear sin el campo cae por defecto en ORDERS', async () => {
    const db = makeCreateDb();
    // Sin costingSystem en el input (como si el cliente viejo no lo mandara).
    await new CostStructureService(db as never).create(
      USER, COMPANY, { productName: 'Mesa' } as never, ctx,
    );
    expect(sistemaGuardado(db)).toBe('ORDERS');
  });
});

describe('B01 — cambiar el sistema de costeo solo mientras no haya cálculos', () => {
  beforeEach(() => vi.clearAllMocks());

  it('cambia el sistema en una estructura sin cálculos', async () => {
    const db = makeUpdateDb(0, 0);
    const updated = await new CostStructureService(db as never).updateCostingSystem(
      USER, STRUCT, 'PROCESSES', ctx,
    );
    const call = db.costStructure.update.mock.calls[0]![0] as { data: { costingSystem: string } };
    expect(call.data.costingSystem).toBe('PROCESSES');
    expect((updated as { costingSystem: string }).costingSystem).toBe('PROCESSES');
  });

  it('🔒 con un CalculationRun ya existente lo bloquea con un 422 en castellano', async () => {
    const db = makeUpdateDb(1, 0);
    const svc = new CostStructureService(db as never);

    await expect(svc.updateCostingSystem(USER, STRUCT, 'PROCESSES', ctx)).rejects.toThrow(
      UnprocessableEntityError,
    );
    await expect(svc.updateCostingSystem(USER, STRUCT, 'PROCESSES', ctx)).rejects.toThrow(
      /No se puede cambiar el sistema de costeo/,
    );
    expect(db.costStructure.update).not.toHaveBeenCalled();
  });

  it('🔒 también lo bloquea si tiene un cálculo del motor legado (CostCalculation)', async () => {
    const db = makeUpdateDb(0, 1);
    const svc = new CostStructureService(db as never);

    await expect(svc.updateCostingSystem(USER, STRUCT, 'PROCESSES', ctx)).rejects.toThrow(
      UnprocessableEntityError,
    );
    expect(db.costStructure.update).not.toHaveBeenCalled();
  });
});
