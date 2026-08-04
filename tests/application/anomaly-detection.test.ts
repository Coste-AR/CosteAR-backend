import { describe, it, expect } from 'vitest';
import {
  detectAnomalies,
  DEFAULT_ANOMALY_THRESHOLDS,
  type AnomalyPeriod,
  type AnomalyFinding,
} from '@/application/alerts/anomaly-detection.js';
import type { FrozenCalculation } from '@/domain/calculations/calculate.js';

/**
 * F7.1 — el detector de anomalías.
 *
 * Lo que se fija acá es, sobre todo, cuándo el detector NO tiene que decir nada:
 *
 *   · Una serie estable no produce hallazgos.
 *   · La producción que se duplica sin que nada se encarezca NO es una anomalía
 *     (la trampa que motiva la regla de "nunca por importe total").
 *   · Sin historia suficiente, S1 y S2 se callan y DICEN por qué.
 *   · Un centro sin datos de cierre no genera una variación fantasma.
 *
 * Y cuándo sí:
 *
 *   · El salto de mezcla, en puntos de participación.
 *   · El precio implícito de una materia prima, separado del consumo.
 *   · Las variaciones de CIF, desde el primer período.
 */

// ---------------------------------------------------------------------------
// Armado de resultados del motor
// ---------------------------------------------------------------------------

interface CenterInput {
  appliedCip: number;
  actualCip?: number;
  budgetVariance?: number;
  volumeVariance?: number;
  overUnderApplied?: number;
  normalCapacity?: number;
  actualActivity?: number;
  pendingClosing?: boolean;
}

function result(o: {
  mp: number;
  mod: number;
  cif: number;
  materials?: { name: string; unit?: string; consumed: number }[];
  centers?: Record<string, CenterInput>;
}): FrozenCalculation {
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
      rawMaterial: {
        optimalLot: 0,
        finalStockQty: 0,
        finalStockValue: 0,
        materials: (o.materials ?? []).map((m) => ({
          name: m.name,
          unit: m.unit ?? 'kg',
          optimalLot: 0,
          finalStockQty: 0,
          finalStockValue: 0,
          consumed: m.consumed,
        })),
      },
      directLabor: {
        workingDays: 0,
        paidDays: 0,
        itcsPercent: 0,
        iapPercent: 0,
        hourlyRates: {},
        itcsBreakdown: { certain: 0, uncertainRemunerative: 0, derived: 0, uncertainNonRemunerative: 0 },
        departments: [],
      },
      indirectCosts: {
        perDepartment: Object.fromEntries(
          Object.entries(o.centers ?? {}).map(([id, c]) => [
            id,
            {
              cipTotal: 0,
              appliedCip: c.appliedCip,
              budgetVariance: c.budgetVariance ?? 0,
              volumeVariance: c.volumeVariance ?? 0,
              normalCapacity: c.normalCapacity ?? 0,
              actualActivity: c.actualActivity ?? 0,
              quota: 0,
              actualCip: c.actualCip ?? 0,
              budgetFixed: 0,
              budgetVariable: 0,
              quotaFixed: 0,
              quotaVariable: 0,
              overUnderApplied: c.overUnderApplied ?? 0,
              pendingClosing: c.pendingClosing ?? false,
              appliedOn: 'actualActivity' as const,
            },
          ]),
        ),
      },
      unitCost: { unitsProduced: 0, unitProductionCost: 0, unitCostOfGoodsSold: 0 },
    },
  };
}

/** Ficha de MP: solo lo que el detector mira (las cantidades consumidas). */
function rmConfig(materials: { name: string; consumed: number }[]) {
  return {
    materials: materials.map((m) => ({
      name: m.name,
      unit: 'kg',
      movements: [{ date: '10/06/2026', type: 'consumption', detail: 'Consumo', quantity: m.consumed }],
    })),
  };
}

const icConfig = {
  centers: [
    { id: 'corte', name: 'Corte', type: 'productive' },
    { id: 'armado', name: 'Armado', type: 'productive' },
  ],
};

/** Un período estable: mezcla 50/30/20, 100 unidades. */
function stablePeriod(code: string, factor = 1): AnomalyPeriod {
  return {
    code,
    label: code,
    units: 100 * factor,
    result: result({
      mp: 50_000 * factor,
      mod: 30_000 * factor,
      cif: 20_000 * factor,
      materials: [{ name: 'Chapa', consumed: 50_000 * factor }],
    }),
    rawMaterialConfig: rmConfig([{ name: 'Chapa', consumed: 500 * factor }]),
    indirectCostConfig: icConfig,
  };
}

const history = (n: number, factor = 1): AnomalyPeriod[] =>
  Array.from({ length: n }, (_, i) => stablePeriod(`2026-0${i + 1}`, factor));

const find = (fs: AnomalyFinding[], signal: string, conceptKey: string) =>
  fs.find((f) => f.signal === signal && f.conceptKey === conceptKey);

// ---------------------------------------------------------------------------

describe('detectAnomalies — cuándo NO hay que decir nada', () => {
  it('una serie estable no produce ningún hallazgo', () => {
    const report = detectAnomalies({ current: stablePeriod('2026-05'), history: history(4) });

    expect(report.findings).toEqual([]);
    expect(report.skipped).toEqual([]);
    expect(report.periodsAvailable).toBe(4);
  });

  it('duplicar la producción sin que nada se encarezca NO es una anomalía', () => {
    // Todos los importes al doble, la mezcla y el costo unitario intactos. Es el
    // caso que rompería un detector que mire importes totales.
    const report = detectAnomalies({ current: stablePeriod('2026-05', 2), history: history(4) });

    expect(report.findings).toEqual([]);
  });

  it('con 2 períodos de historia S1 y S2 se callan, y dicen por qué', () => {
    const report = detectAnomalies({
      current: stablePeriod('2026-03'),
      history: history(2),
    });

    expect(report.findings.filter((f) => f.signal !== 'CIF_VARIANCE')).toEqual([]);
    expect(report.periodsAvailable).toBe(2);
    expect(report.periodsRequired).toBe(3);

    const motivos = report.skipped.map((s) => s.reason);
    expect(report.skipped.map((s) => s.signal)).toEqual(['MIX_DEVIATION', 'UNIT_COST_JUMP']);
    expect(motivos[0]).toContain('van 2 de 3 períodos cerrados');
  });

  it('la ventana se corta por los períodos MÁS NUEVOS, no por los más viejos', () => {
    // 8 períodos viejos con mezcla rara + 6 recientes estables. Con lookback 6, la
    // media móvil tiene que ignorar los viejos y no detectar nada.
    const recientes = history(6);
    const viejos = Array.from({ length: 8 }, (_, i) => ({
      ...stablePeriod(`2025-0${i + 1}`),
      result: result({ mp: 10_000, mod: 10_000, cif: 80_000 }),
    }));

    const report = detectAnomalies({
      current: stablePeriod('2026-07'),
      history: [...recientes, ...viejos],
    });

    expect(report.findings).toEqual([]);
  });
});

describe('S1 — desvío de mezcla', () => {
  it('detecta el salto de participación y lo expresa en puntos', () => {
    // La MP pasa de 50% a 70% del costo: 20 puntos, el doble del umbral.
    const current: AnomalyPeriod = {
      ...stablePeriod('2026-05'),
      units: 100,
      result: result({ mp: 70_000, mod: 18_000, cif: 12_000 }),
    };

    const { findings } = detectAnomalies({ current, history: history(4) });
    const mp = find(findings, 'MIX_DEVIATION', 'rawMaterial')!;

    expect(mp).toBeDefined();
    expect(mp.actual).toBe(70);
    expect(mp.baseline).toBe(50);
    expect(mp.deviation).toBe(20);
    expect(mp.severity).toBe('critical'); // 20 puntos = 2 × umbral
    expect(mp.periodsUsed).toBe(4);
    expect(mp.message).toContain('el 70,0% del costo');
    expect(mp.message).toContain('venía siendo el 50,0%');
    expect(mp.message).toContain('subió 20,0 puntos');
  });

  it('un desvío por debajo del umbral no genera nada', () => {
    // 59% vs 50%: 9 puntos, justo por debajo de los 10.
    const current: AnomalyPeriod = {
      ...stablePeriod('2026-05'),
      result: result({ mp: 59_000, mod: 25_000, cif: 16_000 }),
    };

    const { findings } = detectAnomalies({ current, history: history(4) });
    expect(find(findings, 'MIX_DEVIATION', 'rawMaterial')).toBeUndefined();
  });

  it('los períodos sin costo no entran en la media: si no alcanzan, se salta y se dice', () => {
    const vacios = Array.from({ length: 3 }, (_, i) => ({
      ...stablePeriod(`2026-0${i + 1}`),
      result: result({ mp: 0, mod: 0, cif: 0 }),
    }));

    const report = detectAnomalies({
      current: stablePeriod('2026-05'),
      history: [...vacios, stablePeriod('2026-04')],
    });

    expect(report.findings.filter((f) => f.signal === 'MIX_DEVIATION')).toEqual([]);
    const skip = report.skipped.find((s) => s.signal === 'MIX_DEVIATION')!;
    expect(skip.reason).toContain('Solo 1 de los períodos anteriores');
  });

  it('el período actual sin costo de producción no se evalúa', () => {
    const report = detectAnomalies({
      current: { ...stablePeriod('2026-05'), result: result({ mp: 0, mod: 0, cif: 0 }) },
      history: history(4),
    });

    const skip = report.skipped.find((s) => s.signal === 'MIX_DEVIATION')!;
    expect(skip.reason).toContain('no tiene costo de producción');
  });
});

describe('S2 — salto de costo unitario', () => {
  it('detecta el salto del costo por unidad', () => {
    // Mismo mix, misma producción, todo 40% más caro: la mezcla no se mueve, el
    // costo unitario sí. Es el caso que S1 no puede ver.
    const current: AnomalyPeriod = {
      ...stablePeriod('2026-05'),
      units: 100,
      result: result({ mp: 70_000, mod: 42_000, cif: 28_000 }),
    };

    const { findings } = detectAnomalies({ current, history: history(4) });

    expect(find(findings, 'MIX_DEVIATION', 'rawMaterial')).toBeUndefined();

    const total = find(findings, 'UNIT_COST_JUMP', 'productionCost')!;
    expect(total.baseline).toBe(1000); // 100.000 / 100
    expect(total.actual).toBe(1400);
    expect(total.deviation).toBe(40);
    expect(total.message).toContain('subió 40,0%');
    expect(total.message).toContain('$1.000,0000 a $1.400,0000');
  });

  it('sin cantidad producida no se evalúa, y se dice qué falta', () => {
    const report = detectAnomalies({
      current: { ...stablePeriod('2026-05'), units: null },
      history: history(4),
    });

    expect(report.findings.filter((f) => f.conceptKey === 'productionCost')).toEqual([]);
    const skip = report.skipped.find((s) => s.signal === 'UNIT_COST_JUMP')!;
    expect(skip.reason).toContain('Falta la cantidad producida');
    expect(skip.reason).toContain('sección de Venta');
  });

  it('separa el precio de la materia prima del consumo', () => {
    // Se consume la MISMA cantidad (500 kg) pero valorizada a $75.000: el kilo
    // pasó de $100 a $150. Es precio, no desperdicio.
    const current: AnomalyPeriod = {
      code: '2026-05',
      label: '2026-05',
      units: 100,
      result: result({
        mp: 75_000,
        mod: 30_000,
        cif: 20_000,
        materials: [{ name: 'Chapa', consumed: 75_000 }],
      }),
      rawMaterialConfig: rmConfig([{ name: 'Chapa', consumed: 500 }]),
      indirectCostConfig: icConfig,
    };

    const { findings } = detectAnomalies({ current, history: history(4) });
    const chapa = find(findings, 'UNIT_COST_JUMP', 'Chapa')!;

    expect(chapa).toBeDefined();
    expect(chapa.baseline).toBe(100);
    expect(chapa.actual).toBe(150);
    expect(chapa.deviation).toBe(50);
    expect(chapa.message).toContain('el kg se consumió a $150,0000');
    expect(chapa.message).toContain('un 50,0% más');
  });

  it('consumir más al mismo precio NO dispara la alerta de precio', () => {
    // El doble de kilos al mismo precio: la MP sube en importe y en participación,
    // pero el precio del kilo no se movió. Los dos hechos tienen que quedar
    // separados, que es exactamente lo que el costista necesita saber.
    const current: AnomalyPeriod = {
      code: '2026-05',
      label: '2026-05',
      units: 100,
      result: result({
        mp: 100_000,
        mod: 30_000,
        cif: 20_000,
        materials: [{ name: 'Chapa', consumed: 100_000 }],
      }),
      rawMaterialConfig: rmConfig([{ name: 'Chapa', consumed: 1000 }]),
      indirectCostConfig: icConfig,
    };

    const { findings } = detectAnomalies({ current, history: history(4) });

    expect(find(findings, 'UNIT_COST_JUMP', 'Chapa')).toBeUndefined();
    expect(find(findings, 'MIX_DEVIATION', 'rawMaterial')).toBeDefined();
  });

  it('una materia prima nueva no tiene contra qué compararse', () => {
    const current: AnomalyPeriod = {
      code: '2026-05',
      label: '2026-05',
      units: 100,
      result: result({
        mp: 50_000,
        mod: 30_000,
        cif: 20_000,
        materials: [{ name: 'Aluminio', consumed: 50_000 }],
      }),
      rawMaterialConfig: rmConfig([{ name: 'Aluminio', consumed: 100 }]),
      indirectCostConfig: icConfig,
    };

    const { findings } = detectAnomalies({ current, history: history(4) });
    expect(find(findings, 'UNIT_COST_JUMP', 'Aluminio')).toBeUndefined();
  });
});

describe('S3 — variaciones de CIF', () => {
  const soloCif = (centers: Record<string, CenterInput>): AnomalyPeriod => ({
    code: '2026-01',
    label: 'Enero 2026',
    units: 100,
    result: result({ mp: 50_000, mod: 30_000, cif: 20_000, centers }),
    indirectCostConfig: icConfig,
  });

  it('funciona en el primer período, sin nada de historia', () => {
    const report = detectAnomalies({
      current: soloCif({
        corte: {
          appliedCip: 20_000,
          actualCip: 23_000,
          overUnderApplied: -3_000,
          volumeVariance: 2_500,
          normalCapacity: 1000,
          actualActivity: 850,
        },
      }),
      history: [],
    });

    const sub = find(report.findings, 'CIF_VARIANCE', 'corte:overUnder')!;
    expect(sub).toBeDefined();
    expect(sub.baseline).toBeNull();
    expect(sub.periodsUsed).toBe(0);
    expect(sub.deviation).toBe(-15); // 3.000 sobre 20.000
    expect(sub.severity).toBe('critical');
    expect(sub.conceptLabel).toBe('Corte — aplicación de CIF');
    expect(sub.explanation[0]).toContain('quedó sin absorber');

    const volumen = find(report.findings, 'CIF_VARIANCE', 'corte:volumeVariance')!;
    expect(volumen.explanation[0]).toContain('capacidad ociosa');
  });

  it('un centro sin datos de cierre no genera variaciones fantasma', () => {
    const report = detectAnomalies({
      current: soloCif({ corte: { appliedCip: 20_000, pendingClosing: true } }),
      history: [],
    });

    expect(report.findings.filter((f) => f.signal === 'CIF_VARIANCE')).toEqual([]);
    const skip = report.skipped.find((s) => s.signal === 'CIF_VARIANCE')!;
    expect(skip.reason).toContain('1 centro no tiene');
    expect(skip.reason).toContain('actividad real y CIF real');
  });

  it('una variación por debajo del umbral no molesta a nadie', () => {
    const report = detectAnomalies({
      current: soloCif({ corte: { appliedCip: 20_000, overUnderApplied: -800 } }), // 4% < 5%
      history: [],
    });

    expect(report.findings).toEqual([]);
  });

  it('un centro que no aplicó CIF no tiene escala contra la cual medir', () => {
    const report = detectAnomalies({
      current: soloCif({ corte: { appliedCip: 0, overUnderApplied: -5_000 } }),
      history: [],
    });

    expect(report.findings).toEqual([]);
  });

  it('usa el nombre del centro, no su id', () => {
    const report = detectAnomalies({
      current: soloCif({ armado: { appliedCip: 10_000, budgetVariance: 2_000 } }),
      history: [],
    });

    expect(report.findings[0]!.message).toContain('Armado');
    expect(report.findings[0]!.message).not.toContain('armado:');
  });
});

describe('el reporte', () => {
  it('ordena primero lo grave y, dentro de eso, lo que más se movió', () => {
    const current: AnomalyPeriod = {
      code: '2026-05',
      label: '2026-05',
      units: 100,
      result: result({
        mp: 70_000,
        mod: 18_000,
        cif: 12_000,
        materials: [{ name: 'Chapa', consumed: 70_000 }],
        centers: { corte: { appliedCip: 12_000, overUnderApplied: -800 } },
      }),
      rawMaterialConfig: rmConfig([{ name: 'Chapa', consumed: 500 }]),
      indirectCostConfig: icConfig,
    };

    const { findings } = detectAnomalies({ current, history: history(4) });

    // Hay de los dos niveles y ninguno crítico puede quedar detrás de un warn.
    const rank = { critical: 0, warn: 1, info: 2 };
    const ranks = findings.map((f) => rank[f.severity]);
    expect(new Set(ranks).size).toBeGreaterThan(1);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));

    // Y dentro del mismo nivel, primero el que más se movió.
    const criticos = findings.filter((f) => f.severity === 'critical').map((f) => Math.abs(f.deviation));
    expect(criticos).toEqual([...criticos].sort((a, b) => b - a));
  });

  it('los umbrales se pueden ajustar por usuario', () => {
    const current: AnomalyPeriod = {
      ...stablePeriod('2026-05'),
      result: result({ mp: 56_000, mod: 26_000, cif: 18_000 }), // 56% vs 50%: 6 puntos
    };

    expect(detectAnomalies({ current, history: history(4) }).findings).toEqual([]);

    const { findings } = detectAnomalies({
      current,
      history: history(4),
      thresholds: { mixDeviationPoints: 5 },
    });
    expect(find(findings, 'MIX_DEVIATION', 'rawMaterial')).toBeDefined();
  });

  it('los defaults son los documentados en el plan', () => {
    expect(DEFAULT_ANOMALY_THRESHOLDS).toEqual({
      mixDeviationPoints: 10,
      unitCostJumpPct: 20,
      cifVariancePct: 5,
      lookbackPeriods: 6,
      minPeriods: 3,
    });
  });
});
