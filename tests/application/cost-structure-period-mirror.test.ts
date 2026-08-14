import { describe, it, expect, vi } from 'vitest';
import { CostStructureService } from '@/application/cost-structures/cost-structure-service.js';
import { ValidationError } from '@/domain/errors/domain-error.js';

vi.mock('@/application/audit/audit-logger.js', () => ({
  recordAudit: vi.fn(async () => undefined),
}));

/**
 * C — Fase 3: guardar en la pantalla es guardar en el PERÍODO ABIERTO.
 *
 * La app escribe en `cost_structures` (la Fase 1 no movió los datos de lugar, a
 * propósito). Si esa escritura no se espeja en el período, el período queda con
 * la foto del día que se abrió: el cierre validaría datos viejos (y no dejaría
 * cerrar nunca) y el mes siguiente arrastraría una existencia que no fue la real.
 *
 * Y el candado: en un mes cerrado no se escribe.
 */

const USER = 'user-1';
const STRUCTURE = 'struct-1';

/** Una config de MP válida para el schema (es lo que se va a guardar). */
const configMP = {
  materials: [
    {
      name: 'Chapa',
      wilson: { annualDemand: 6000, orderCost: 500, holdingRate: 0.3, unitCost: 1200 },
      stockPolicy: {
        minConsumption: 10,
        maxConsumption: 30,
        minLeadTime: 5,
        maxLeadTime: 10,
        safetyStock: 50,
      },
      initialStock: { quantity: 300, unitCost: 1160 },
      movements: [
        { date: '05/07/2026', type: 'purchase', detail: 'Compra', quantity: 200, unitCost: 1300 },
      ],
    },
  ],
};

function makeDb(periods: Record<string, unknown>[]) {
  const db: Record<string, unknown> = {
    costStructure: {
      findFirst: vi.fn(async () => ({
        id: STRUCTURE,
        userId: USER,
        companyId: 'comp-1',
        rawMaterialConfig: null,
      })),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: STRUCTURE, ...data })),
    },
    costPeriod: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        where.status === 'OPEN'
          ? (periods.find((p) => p.status === 'OPEN') ?? null)
          : (periods[0] ?? null),
      ),
      update: vi.fn(async () => ({})),
    },
    costConfigVersion: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async () => ({})),
    },
    // Trazabilidad (T-01): guardar una sección reconcilia sus data points en la
    // MISMA transacción. Sin data points previos, todo lo de la config se crea.
    dataPoint: {
      findMany: vi.fn(async () => []),
      create: vi.fn(async () => ({ id: 'dp-1' })),
      update: vi.fn(async () => ({ id: 'dp-1' })),
    },
    dataPointVersion: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async () => ({ id: 'v-1' })),
    },
    traceAuditLog: { create: vi.fn(async () => ({})) },
  };
  db.$transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn(db));
  return db as {
    costStructure: { findFirst: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
    costPeriod: { findFirst: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
    costConfigVersion: { findFirst: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
    $transaction: ReturnType<typeof vi.fn>;
  };
}

const ctx = { ip: '127.0.0.1', userAgent: 'test' } as never;

describe('Guardar una sección con período abierto', () => {
  it('escribe en la estructura Y en el período abierto (misma transacción)', async () => {
    const db = makeDb([{ id: 'per-julio', label: 'Julio 2026', status: 'OPEN' }]);

    const svc = new CostStructureService(db as never);
    await svc.updateConfig(USER, STRUCTURE, 'rawMaterial', configMP, ctx);

    expect(db.costStructure.update).toHaveBeenCalledTimes(1);
    expect(db.costPeriod.update).toHaveBeenCalledTimes(1);

    const enPeriodo = db.costPeriod.update.mock.calls[0]![0] as {
      where: { id: string };
      data: { rawMaterialConfig: typeof configMP };
    };
    expect(enPeriodo.where.id).toBe('per-julio');
    // El período guarda exactamente lo mismo que la estructura: la compra de julio.
    expect(enPeriodo.data.rawMaterialConfig.materials[0]!.movements).toHaveLength(1);
  });
});

describe('Guardar con el mes cerrado', () => {
  it('no deja escribir y dice qué hacer (reabrir o abrir el siguiente)', async () => {
    const db = makeDb([{ id: 'per-junio', label: 'Junio 2026', status: 'CLOSED' }]);

    const svc = new CostStructureService(db as never);
    await expect(
      svc.updateConfig(USER, STRUCTURE, 'rawMaterial', configMP, ctx),
    ).rejects.toThrow(ValidationError);
    await expect(
      svc.updateConfig(USER, STRUCTURE, 'rawMaterial', configMP, ctx),
    ).rejects.toThrow(/Junio 2026/);

    // Un mes congelado no se toca: ni la estructura, ni el historial de versiones.
    expect(db.costStructure.update).not.toHaveBeenCalled();
    expect(db.costConfigVersion.create).not.toHaveBeenCalled();
  });

  it('tampoco deja cambiar las ventas', async () => {
    const db = makeDb([{ id: 'per-junio', label: 'Junio 2026', status: 'CLOSED' }]);

    const svc = new CostStructureService(db as never);
    await expect(svc.updateSales(USER, STRUCTURE, 5000, 120, ctx)).rejects.toThrow(ValidationError);
    expect(db.costStructure.update).not.toHaveBeenCalled();
  });
});

describe('Estructura sin períodos (legado)', () => {
  it('guarda como siempre: no hay período que espejar y nada se rompe', async () => {
    const db = makeDb([]);

    const svc = new CostStructureService(db as never);
    await svc.updateConfig(USER, STRUCTURE, 'rawMaterial', configMP, ctx);

    expect(db.costStructure.update).toHaveBeenCalledTimes(1);
    expect(db.costPeriod.update).not.toHaveBeenCalled();
  });

  it('las ventas también se guardan como siempre', async () => {
    const db = makeDb([]);

    const svc = new CostStructureService(db as never);
    await svc.updateSales(USER, STRUCTURE, 5000, 120, ctx);

    expect(db.costStructure.update).toHaveBeenCalledTimes(1);
    expect(db.costPeriod.update).not.toHaveBeenCalled();
  });
});
