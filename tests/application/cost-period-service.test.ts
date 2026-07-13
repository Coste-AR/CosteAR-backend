import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CostPeriodService } from '@/application/cost-structures/cost-period-service.js';
import { ValidationError } from '@/domain/errors/domain-error.js';

vi.mock('@/application/audit/audit-logger.js', () => ({
  recordAudit: vi.fn(async () => undefined),
}));

/**
 * C — Fase 1. Las tres operaciones del período: abrir, cerrar y reabrir.
 *
 * Reglas que se fijan acá:
 *   · Un período nuevo NO arrastra lo que es del mes (compras, consumos,
 *     actividad real, CIP real). Arrastrarlo sería costear julio con los
 *     movimientos de junio.
 *   · NO se puede cerrar un período con centros sin actividad real / CIP real
 *     (la regla de E3): el cierre es cuando el sistema exige lo que falta.
 *   · Reabrir se puede, pero exige motivo y deja rastro.
 */

const USER = 'user-1';
const STRUCTURE = 'struct-1';

const junio = {
  id: 'per-junio',
  structureId: STRUCTURE,
  userId: USER,
  code: '2026-06',
  label: 'Junio 2026',
  status: 'CLOSED' as const,
  closedAt: new Date('2026-07-02'),
  rawMaterialConfig: {
    materials: [
      {
        name: 'Chapa',
        wilson: { annualDemand: 6000 },
        initialStock: { quantity: 100, unitCost: 1000 },
        movements: [{ date: '05/06/2026', type: 'purchase', quantity: 400, unitCost: 1200 }],
      },
    ],
  },
  directLaborConfig: {
    departments: [{ name: 'Corte', basicRemuneration: 800000, hoursWorked: 160 }],
  },
  indirectCostConfig: {
    centers: [{ id: 'corte', name: 'Corte', type: 'productive' }],
    concepts: [{ name: 'Alquiler', amount: { fixed: 300000, variable: 0 }, distribution: { corte: 40 } }],
    productiveSettings: [
      { centerId: 'corte', normalCapacity: 160, actualActivity: 150, actualCip: 350000 },
    ],
  },
};

function makeDb(overrides: Record<string, unknown> = {}) {
  return {
    costStructure: {
      findFirst: vi.fn(async () => ({
        id: STRUCTURE,
        userId: USER,
        companyId: 'comp-1',
        period: '2026-06',
        deletedAt: null,
        company: { id: 'comp-1', periodicity: 'MONTHLY' },
      })),
    },
    costPeriod: {
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'per-nuevo', ...data })),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'per-x', ...data })),
    },
    ...overrides,
  };
}

const ctx = { ip: '127.0.0.1', userAgent: 'test' } as never;

describe('ABRIR período', () => {
  let db: ReturnType<typeof makeDb>;
  beforeEach(() => { db = makeDb(); });

  it('abre el mes siguiente al último cerrado (junio → julio)', async () => {
    db.costPeriod.findFirst = vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
      where.status === 'OPEN' ? null : junio,
    ) as never;

    const svc = new CostPeriodService(db as never);
    const nuevo = await svc.openNext(USER, STRUCTURE, { recipe: true }, ctx);

    expect(nuevo.code).toBe('2026-07');
    expect(nuevo.label).toBe('Julio 2026');
    expect(nuevo.status).toBe('OPEN');
  });

  it('NO arrastra lo que es del mes: compras, consumos, actividad real ni CIP real', async () => {
    db.costPeriod.findFirst = vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
      where.status === 'OPEN' ? null : junio,
    ) as never;

    const svc = new CostPeriodService(db as never);
    const nuevo = await svc.openNext(USER, STRUCTURE, { recipe: true }, ctx) as never as {
      rawMaterialConfig: { materials: { movements: unknown[]; initialStock: unknown }[] };
      indirectCostConfig: { productiveSettings: { actualActivity: number; actualCip: number; normalCapacity: number }[] };
    };

    // Los movimientos de junio NO viajan a julio.
    expect(nuevo.rawMaterialConfig.materials[0]!.movements).toEqual([]);
    // La ficha del insumo sí (es la receta).
    expect(nuevo.rawMaterialConfig.materials[0]!.initialStock).toEqual({ quantity: 100, unitCost: 1000 });
    // El cierre de junio NO viaja a julio; la capacidad normal sí.
    const ps = nuevo.indirectCostConfig.productiveSettings[0]!;
    expect(ps.actualActivity).toBe(0);
    expect(ps.actualCip).toBe(0);
    expect(ps.normalCapacity).toBe(160);
  });

  it('sin pedir arrastre de importes, los importes arrancan en cero', async () => {
    db.costPeriod.findFirst = vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
      where.status === 'OPEN' ? null : junio,
    ) as never;

    const svc = new CostPeriodService(db as never);
    const nuevo = await svc.openNext(USER, STRUCTURE, { recipe: true, amounts: false }, ctx) as never as {
      directLaborConfig: { departments: { basicRemuneration: number; hoursWorked: number }[] };
      indirectCostConfig: { concepts: { amount: { fixed: number } }[] };
    };

    expect(nuevo.indirectCostConfig.concepts[0]!.amount.fixed).toBe(0);
    expect(nuevo.directLaborConfig.departments[0]!.basicRemuneration).toBe(0);
    // Pero la receta queda: el departamento sigue existiendo con sus horas.
    expect(nuevo.directLaborConfig.departments[0]!.hoursWorked).toBe(160);
  });

  it('si el costista pide arrastrar los importes, vienen los del mes anterior', async () => {
    db.costPeriod.findFirst = vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
      where.status === 'OPEN' ? null : junio,
    ) as never;

    const svc = new CostPeriodService(db as never);
    const nuevo = await svc.openNext(USER, STRUCTURE, { recipe: true, amounts: true }, ctx) as never as {
      directLaborConfig: { departments: { basicRemuneration: number }[] };
      indirectCostConfig: { concepts: { amount: { fixed: number } }[] };
    };

    expect(nuevo.indirectCostConfig.concepts[0]!.amount.fixed).toBe(300000);
    expect(nuevo.directLaborConfig.departments[0]!.basicRemuneration).toBe(800000);
  });

  it('no deja abrir un período nuevo si hay uno abierto', async () => {
    db.costPeriod.findFirst = vi.fn(async () => ({ ...junio, status: 'OPEN', label: 'Junio 2026' })) as never;

    const svc = new CostPeriodService(db as never);
    await expect(svc.openNext(USER, STRUCTURE, { recipe: true }, ctx)).rejects.toThrow(ValidationError);
  });
});

describe('CERRAR período', () => {
  it('no deja cerrar si un centro no tiene actividad real y CIP real (regla de E3)', async () => {
    const db = makeDb();
    db.costPeriod.findFirst = vi.fn(async () => ({
      ...junio,
      status: 'OPEN',
      indirectCostConfig: {
        centers: [{ id: 'corte', name: 'Corte', type: 'productive' }],
        productiveSettings: [{ centerId: 'corte', normalCapacity: 160, actualActivity: 0, actualCip: 0 }],
      },
    })) as never;

    const svc = new CostPeriodService(db as never);
    await expect(svc.close(USER, 'per-x', null, ctx)).rejects.toThrow(/Corte/);
    expect(db.costPeriod.update).not.toHaveBeenCalled();
  });

  it('con el cierre completo, congela el período', async () => {
    const db = makeDb();
    db.costPeriod.findFirst = vi.fn(async () => ({ ...junio, status: 'OPEN' })) as never;

    const svc = new CostPeriodService(db as never);
    const cerrado = await svc.close(USER, 'per-x', 'run-9', ctx);

    expect(cerrado.status).toBe('CLOSED');
    expect(cerrado.closedBy).toBe(USER);
    expect(cerrado.closedRunId).toBe('run-9');
  });

  it('un período ya cerrado no se cierra dos veces', async () => {
    const db = makeDb();
    db.costPeriod.findFirst = vi.fn(async () => junio) as never; // CLOSED

    const svc = new CostPeriodService(db as never);
    await expect(svc.close(USER, 'per-junio', null, ctx)).rejects.toThrow(ValidationError);
  });
});

describe('REABRIR período', () => {
  it('exige un motivo de verdad (no sirve "porque sí")', async () => {
    const db = makeDb();
    db.costPeriod.findFirst = vi.fn(async () => junio) as never;

    const svc = new CostPeriodService(db as never);
    await expect(svc.reopen(USER, 'per-junio', 'ups', ctx)).rejects.toThrow(ValidationError);
    expect(db.costPeriod.update).not.toHaveBeenCalled();
  });

  it('reabre y deja rastro: motivo, fecha y contador', async () => {
    const db = makeDb();
    db.costPeriod.findFirst = vi.fn(async () => junio) as never;
    db.costPeriod.update = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'per-junio', ...data, reopenCount: 1,
    })) as never;

    const svc = new CostPeriodService(db as never);
    const r = await svc.reopen(USER, 'per-junio', 'Llegó tarde la factura de energía de junio', ctx);

    expect(r.status).toBe('OPEN');
    expect(r.reopenReason).toBe('Llegó tarde la factura de energía de junio');
    expect(r.reopenedAt).toBeInstanceOf(Date);
  });

  it('no se puede reabrir un período que está abierto', async () => {
    const db = makeDb();
    db.costPeriod.findFirst = vi.fn(async () => ({ ...junio, status: 'OPEN' })) as never;

    const svc = new CostPeriodService(db as never);
    await expect(
      svc.reopen(USER, 'per-junio', 'Un motivo suficientemente largo', ctx),
    ).rejects.toThrow(ValidationError);
  });
});
