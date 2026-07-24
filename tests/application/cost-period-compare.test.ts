import { describe, it, expect, vi } from 'vitest';
import { CostPeriodService } from '@/application/cost-structures/cost-period-service.js';
import { ValidationError, NotFoundError } from '@/domain/errors/domain-error.js';

vi.mock('@/application/audit/audit-logger.js', () => ({
  recordAudit: vi.fn(async () => undefined),
}));

/**
 * C — Fase 4: el servicio de comparación.
 *
 * Lo que se fija acá:
 *   · Sin elegir nada, compara los dos últimos (lo que el costista quiere ver).
 *   · Un mes CERRADO con su resultado congelado se LEE: no se recalcula nunca.
 *   · Un mes abierto (o cerrado antes de la Fase 4) se recalcula, y se dice.
 *   · La variación siempre se lee del más viejo al más nuevo, aunque los manden
 *     al revés.
 */

const USER = 'user-1';
const STRUCTURE = 'struct-1';

/** El resultado congelado de un mes (solo los campos que la comparación mira). */
function snapshot(mp: number, mod: number, cif: number) {
  return {
    rawMaterialConsumed: mp,
    directLaborTotal: mod,
    indirectCostsApplied: cif,
    productionCost: mp + mod + cif,
    costOfGoodsSold: mp + mod + cif,
    grossMargin: 0,
    grossMarginPct: 0,
    detail: {
      rawMaterial: { optimalLot: 0, finalStockQty: 0, finalStockValue: 0, materials: [] },
      directLabor: {
        workingDays: 0, paidDays: 0, itcsPercent: 0, iapPercent: 0, hourlyRates: {},
        itcsBreakdown: { certain: 0, uncertainRemunerative: 0, derived: 0, uncertainNonRemunerative: 0 },
        departments: [],
      },
      indirectCosts: { perDepartment: {} },
    },
  };
}

function period(o: {
  code: string;
  label: string;
  status?: 'OPEN' | 'CLOSED';
  snap?: ReturnType<typeof snapshot> | null;
  units?: number;
  startDate?: Date;
  endDate?: Date;
}) {
  return {
    id: `per-${o.code}`,
    structureId: STRUCTURE,
    userId: USER,
    code: o.code,
    label: o.label,
    status: o.status ?? 'CLOSED',
    resultSnapshot: o.snap ?? null,
    rawMaterialConfig: { materials: [{ id: 'm1', name: 'M1', unit: 'kg', expectedYield: 1, initialStock: { quantity: 0, unitCost: 0 }, initialStockQty: 0, initialStockValue: 0, stockPolicy: { type: 'FIFO', minConsumption: 1, maxConsumption: 1, minLeadTime: 1, maxLeadTime: 1, safetyStock: 1 }, wilson: { annualDemand: 1, orderCost: 1, holdingRate: 0.1, unitCost: 1, calculatedEOQ: 1 }, purchases: [], movements: [] }] },
    directLaborConfig: { workingDays: { expected: 1, actual: 1, paid: 1, dailyHours: 1 }, itcs: { percentage: 0.1, type: 'CERTAIN' }, departments: [] },
    indirectCostConfig: { centers: [] },
    salesUnitPrice: 5000,
    salesQuantity: o.units ?? 100,
    startDate: o.startDate ?? new Date(`${o.code}-01`),
    endDate: o.endDate ?? new Date(`${o.code}-28`),
  };
}

function makeDb(periods: unknown[]) {
  return {
    costStructure: {
      findFirst: vi.fn(async () => ({
        id: STRUCTURE,
        userId: USER,
        period: '2026-06',
        company: { periodicity: 'MONTHLY' },
      })),
    },
    costPeriod: {
      findMany: vi.fn(async () => periods),
    },
  };
}

const mayo = period({ code: '2026-05', label: 'Mayo 2026', snap: snapshot(500000, 200000, 100000) });
const junio = period({ code: '2026-06', label: 'Junio 2026', snap: snapshot(600000, 220000, 110000) });

describe('COMPARAR períodos (servicio)', () => {
  it('sin elegir nada, compara el último contra el anterior', async () => {
    // Vienen del más nuevo al más viejo, como los devuelve la base.
    const db = makeDb([junio, mayo]);
    const svc = new CostPeriodService(db as never);

    const c = await svc.compare(USER, STRUCTURE);

    expect(c.from.code).toBe('2026-05');
    expect(c.to.code).toBe('2026-06');
    expect(c.total.productionCost.a).toBe(800000);
    expect(c.total.productionCost.b).toBe(930000);
    expect(c.total.productionCost.delta).toBe(130000);
  });

  it('un mes cerrado con su resultado congelado se LEE, no se recalcula', async () => {
    const db = makeDb([junio, mayo]);
    const svc = new CostPeriodService(db as never);

    const c = await svc.compare(USER, STRUCTURE);

    expect(c.from.source).toBe('frozen');
    expect(c.to.source).toBe('frozen');
    // Ningún aviso de "se recalculó": los números son los que se firmaron.
    expect(c.warnings.join(' ')).not.toMatch(/recalcul/i);
  });

  it('la variación va del más viejo al más nuevo, aunque los manden al revés', async () => {
    const db = makeDb([junio, mayo]);
    const svc = new CostPeriodService(db as never);

    const c = await svc.compare(USER, STRUCTURE, '2026-06', '2026-05'); // al revés a propósito

    expect(c.from.code).toBe('2026-05');
    expect(c.to.code).toBe('2026-06');
    expect(c.total.productionCost.delta).toBe(130000); // sube, no baja
  });

  it('con un solo período todavía no hay nada que comparar, y lo explica', async () => {
    const db = makeDb([junio]);
    const svc = new CostPeriodService(db as never);

    await expect(svc.compare(USER, STRUCTURE)).rejects.toThrow(ValidationError);
    await expect(svc.compare(USER, STRUCTURE)).rejects.toThrow(/al menos dos períodos/i);
  });

  it('un período que no existe es un 404, no un número inventado', async () => {
    const db = makeDb([junio, mayo]);
    const svc = new CostPeriodService(db as never);

    await expect(svc.compare(USER, STRUCTURE, '2026-01', '2026-06')).rejects.toThrow(NotFoundError);
  });

  it('no se compara un período contra sí mismo', async () => {
    const db = makeDb([junio, mayo]);
    const svc = new CostPeriodService(db as never);

    await expect(svc.compare(USER, STRUCTURE, '2026-06', '2026-06')).rejects.toThrow(/distintos/i);
  });
});

describe('COMPARAR períodos — contraste macro', () => {
  it('macroContrast va null si alguno de los dos períodos no está CLOSED (regla de oro: nunca datos parciales)', async () => {
    const db = makeDb([
      period({ code: '2026-06', label: 'Junio 2026', snap: null, status: 'OPEN' }),
      mayo,
    ]);
    const mockMacro = { cumulativeInflation: vi.fn() };
    const svc = new CostPeriodService(db as never, mockMacro as never);

    const c = await svc.compare(USER, STRUCTURE);

    expect(c.macroContrast).toBeNull();
    expect(mockMacro.cumulativeInflation).not.toHaveBeenCalled();
  });

  it('macroContrast trae la inflación compuesta cuando los dos períodos están CLOSED', async () => {
    const db = makeDb([junio, mayo]);
    const mockMacro = {
      cumulativeInflation: vi.fn().mockResolvedValue({
        deltaPct: 10.25,
        monthsUsed: 2,
        snapshots: [
          { value: 5, effectiveDate: new Date('2026-05-28') },
          { value: 5, effectiveDate: new Date('2026-06-28') },
        ],
      }),
    };
    const svc = new CostPeriodService(db as never, mockMacro as never);

    const c = await svc.compare(USER, STRUCTURE);

    expect(mockMacro.cumulativeInflation).toHaveBeenCalledWith(mayo.endDate, junio.endDate);
    expect(c.macroContrast).toEqual({
      indicatorCode: 'IPC_NACIONAL',
      indicatorLabel: 'Inflación nacional (IPC)',
      deltaPct: 10.25,
      monthsUsed: 2,
      snapshots: [
        { value: 5, effectiveDate: '2026-05-28' },
        { value: 5, effectiveDate: '2026-06-28' },
      ],
    });
  });

  it('sin datos de IPC en el rango, macroContrast es null aunque los dos períodos estén CLOSED', async () => {
    const db = makeDb([junio, mayo]);
    const mockMacro = { cumulativeInflation: vi.fn().mockResolvedValue(null) };
    const svc = new CostPeriodService(db as never, mockMacro as never);

    const c = await svc.compare(USER, STRUCTURE);

    expect(c.macroContrast).toBeNull();
  });
});
