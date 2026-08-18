import { describe, it, expect } from 'vitest';
import {
  detectarAnomaliasDelCierre,
  type PeriodoCerrado,
} from '@/application/alerts/period-anomaly-runner.js';
import type { FrozenCalculation } from '@/domain/calculations/calculate.js';

/**
 * S-05a — el detector de anomalías, enchufado al cierre de período.
 *
 * Lo que se fija acá es la CONEXIÓN, no la matemática: la matemática ya la cubre
 * `anomaly-detection.test.ts`. Lo que importa es que el cierre:
 *
 *   · no genere alertas cuando no hay con qué comparar, y DIGA por qué;
 *   · persista el respaldo del número (`threshold` y `actualValue`), que la
 *     detección ad-hoc anterior dejaba en null;
 *   · no arme filas de alerta con hallazgos meramente informativos.
 */

function frozen(o: { mp: number; mod: number; cif: number }): FrozenCalculation {
  const productionCost = o.mp + o.mod + o.cif;
  return {
    rawMaterialConsumed: o.mp,
    directLaborTotal: o.mod,
    indirectCostsApplied: o.cif,
    productionCost,
    costOfGoodsSold: productionCost,
    grossMargin: 0,
    grossMarginPct: 0,
    detail: {
      rawMaterial: { optimalLot: 0, finalStockQty: 0, finalStockValue: 0, materials: [] },
      directLabor: {
        workingDays: 0,
        paidDays: 0,
        itcsPercent: 0,
        iapPercent: 0,
        hourlyRates: {},
        itcsBreakdown: {
          certain: 0,
          uncertainRemunerative: 0,
          derived: 0,
          uncertainNonRemunerative: 0,
        },
        departments: [],
      },
      indirectCosts: { perDepartment: {} },
      unitCost: { unitsProduced: 0, unitProductionCost: 0, unitCostOfGoodsSold: 0 },
    },
  } as FrozenCalculation;
}

const periodo = (code: string, o: { mp: number; mod: number; cif: number }): PeriodoCerrado => ({
  code,
  label: code,
  resultSnapshot: frozen(o),
});

const IDS = {
  userId: 'user-1',
  companyId: 'company-1',
  costStructureId: 'structure-1',
};

const estable = { mp: 50_000, mod: 30_000, cif: 20_000 };

describe('S-05a — el cierre corre el detector, no una cuenta a mano', () => {
  it('sin historia no inventa una media: no alerta y deja dicho por qué', () => {
    const { report, alertas } = detectarAnomaliasDelCierre({
      actual: periodo('2026-06', estable),
      historia: [],
      ...IDS,
    });

    expect(alertas).toHaveLength(0);
    expect(report.skipped.length).toBeGreaterThan(0);
    // El motivo tiene que ser legible: es lo que se le muestra al costista para
    // que no confunda "no miré" con "está todo bien".
    expect(report.skipped.every((s) => s.reason.trim().length > 0)).toBe(true);
    expect(report.periodsAvailable).toBe(0);
  });

  it('con UN solo período previo tampoco promedia: la detección ad-hoc sí lo hacía', () => {
    const { report, alertas } = detectarAnomaliasDelCierre({
      actual: periodo('2026-06', { mp: 90_000, mod: 30_000, cif: 20_000 }),
      historia: [periodo('2026-05', estable)],
      ...IDS,
    });

    expect(report.periodsAvailable).toBe(1);
    expect(report.periodsRequired).toBeGreaterThan(1);
    expect(alertas).toHaveLength(0);
  });

  it('un período previo sin resultado congelado no entra como cero a la media', () => {
    const sinResultado: PeriodoCerrado = { code: '2026-04', label: '2026-04', resultSnapshot: null };
    const { report } = detectarAnomaliasDelCierre({
      actual: periodo('2026-06', estable),
      historia: [periodo('2026-05', estable), sinResultado, periodo('2026-03', estable)],
      ...IDS,
    });

    // Tres períodos en la historia, pero solo dos utilizables.
    expect(report.periodsAvailable).toBe(2);
  });

  it('si el período cerrado no tiene resultado, no explota: reporta y no alerta', () => {
    const { report, alertas } = detectarAnomaliasDelCierre({
      actual: { code: '2026-06', label: '2026-06', resultSnapshot: null },
      historia: [periodo('2026-05', estable)],
      ...IDS,
    });

    expect(alertas).toHaveLength(0);
    expect(report.findings).toHaveLength(0);
    expect(report.skipped).toHaveLength(3);
  });

  it('con historia suficiente y un salto de mezcla, la alerta lleva su respaldo', () => {
    // La MP pasa de la mitad del costo a bastante más: salta la participación.
    const { report, alertas } = detectarAnomaliasDelCierre({
      actual: periodo('2026-06', { mp: 120_000, mod: 30_000, cif: 20_000 }),
      historia: [
        periodo('2026-05', estable),
        periodo('2026-04', estable),
        periodo('2026-03', estable),
        periodo('2026-02', estable),
      ],
      ...IDS,
    });

    expect(report.findings.length).toBeGreaterThan(0);
    expect(alertas.length).toBeGreaterThan(0);

    for (const a of alertas) {
      // El respaldo del número: la detección anterior dejaba las dos en null.
      expect(a.actualValue).not.toBeNull();
      expect(a.threshold).not.toBeNull();
      // La alerta tiene que entenderse sin contexto: por eso lleva el período.
      expect(String(a.message)).toContain('2026-06');
      expect(a.userId).toBe(IDS.userId);
      expect(a.companyId).toBe(IDS.companyId);
      expect(a.costStructureId).toBe(IDS.costStructureId);
    }
  });

  it('los hallazgos informativos quedan en el reporte pero no generan alerta', () => {
    const { report, alertas } = detectarAnomaliasDelCierre({
      actual: periodo('2026-06', { mp: 120_000, mod: 30_000, cif: 20_000 }),
      historia: [
        periodo('2026-05', estable),
        periodo('2026-04', estable),
        periodo('2026-03', estable),
        periodo('2026-02', estable),
      ],
      ...IDS,
    });

    const queAlertan = report.findings.filter((f) => f.severity !== 'info').length;
    expect(alertas).toHaveLength(queAlertan);
  });

  it('sin unidades producidas, la señal de costo unitario se saltea con motivo', () => {
    // Hoy el resultado congelado no trae unidades. El detector NO divide por lo que
    // haya a mano: se calla y lo dice. Cuando S-02 lleve productionQuantity al
    // motor, esta señal se enciende sola.
    const { report } = detectarAnomaliasDelCierre({
      actual: periodo('2026-06', estable),
      historia: [
        periodo('2026-05', estable),
        periodo('2026-04', estable),
        periodo('2026-03', estable),
      ],
      ...IDS,
    });

    const saltada = report.skipped.find((s) => s.signal === 'UNIT_COST_JUMP');
    expect(saltada).toBeDefined();
    expect(saltada!.reason.trim().length).toBeGreaterThan(0);
  });
});
