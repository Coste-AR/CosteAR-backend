import { describe, it, expect } from 'vitest';
import {
  comparePeriods,
  consumedQuantitiesOf,
  type PeriodSide,
} from '@/application/cost-structures/period-comparison.js';
import type { FrozenCalculation } from '@/domain/calculations/calculate.js';

/**
 * C — Fase 4: la comparación entre períodos.
 *
 * Lo que se fija acá:
 *   · La suma de MP + MOD + CIF ES la variación total (las contribuciones cierran
 *     en 100%): si no, el "80% vino de la materia prima" es un invento.
 *   · La variación de una materia prima se abre EXACTA en precio y consumo:
 *     ΔValor = (P₁−P₀)·Q₁ + (Q₁−Q₀)·P₀, al centavo.
 *   · Nadie divide por cero: mes base en cero, sin consumo, sin unidades.
 *   · El costo POR UNIDAD es el que manda cuando cambia el volumen.
 */

/** Un resultado del motor, armado a mano con los números que queremos comparar. */
function result(o: {
  mp: number;
  mod: number;
  cif: number;
  materials?: { name: string; unit?: string; consumed: number }[];
  departments?: { name: string; totalMod: number }[];
  centers?: Record<string, number>;
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
        departments: (o.departments ?? []).map((d) => ({
          name: d.name,
          basicRemuneration: 0,
          socialChargesCost: 0,
          totalMod: d.totalMod,
          hourlyRate: 0,
          budgetedHours: 0,
        })),
      },
      indirectCosts: {
        perDepartment: Object.fromEntries(
          Object.entries(o.centers ?? {}).map(([id, appliedCip]) => [
            id,
            {
              cipTotal: 0,
              appliedCip,
              budgetVariance: 0,
              volumeVariance: 0,
              normalCapacity: 0,
              actualActivity: 0,
              quota: 0,
              actualCip: 0,
              budgetFixed: 0,
              budgetVariable: 0,
              quotaFixed: 0,
              quotaVariable: 0,
              overUnderApplied: 0,
              pendingClosing: false,
              appliedOn: 'actualActivity' as const,
            },
          ]),
        ),
      },
    },
  };
}

/** Ficha de MP: solo lo que la comparación mira (los consumos del mes). */
function rmConfig(materials: { name: string; consumed: number }[]) {
  return {
    materials: materials.map((m) => ({
      name: m.name,
      unit: 'kg',
      wilson: { annualDemand: 0, orderCost: 0, holdingRate: 0, unitCost: 0 },
      stockPolicy: { minConsumption: 0, maxConsumption: 0, minLeadTime: 0, maxLeadTime: 0, safetyStock: 0 },
      initialStock: { quantity: 0, unitCost: 0 },
      movements: [
        { date: '10/06/2026', type: 'consumption', detail: 'Consumo', quantity: m.consumed },
      ],
    })),
  };
}

const icConfig = {
  centers: [
    { id: 'corte', name: 'Corte', type: 'productive' },
    { id: 'armado', name: 'Armado', type: 'productive' },
  ],
};

function side(o: {
  code: string;
  label: string;
  status?: 'OPEN' | 'CLOSED';
  source?: 'frozen' | 'recomputed';
  result: FrozenCalculation;
  consumos?: { name: string; consumed: number }[];
  units?: number | null;
}): PeriodSide {
  return {
    code: o.code,
    label: o.label,
    status: o.status ?? 'CLOSED',
    source: o.source ?? 'frozen',
    result: o.result,
    rawMaterialConfig: rmConfig(o.consumos ?? []),
    indirectCostConfig: icConfig,
    units: o.units === undefined ? 100 : o.units,
  };
}

describe('COMPARACIÓN entre períodos — los tres elementos', () => {
  /**
   * Junio → Julio. El costo de producción sube de $1.000.000 a $1.200.000 (+20%),
   * y de esos $200.000 la materia prima puso $160.000: el 80%.
   */
  const junio = side({
    code: '2026-06',
    label: 'Junio 2026',
    result: result({ mp: 600000, mod: 250000, cif: 150000 }),
  });
  const julio = side({
    code: '2026-07',
    label: 'Julio 2026',
    result: result({ mp: 760000, mod: 270000, cif: 170000 }),
  });

  it('reparte la suba entre MP, MOD y CIF, y las tres cierran en 100%', () => {
    const c = comparePeriods(junio, julio);

    expect(c.total.productionCost.a).toBe(1000000);
    expect(c.total.productionCost.b).toBe(1200000);
    expect(c.total.productionCost.delta).toBe(200000);
    expect(c.total.productionCost.deltaPct).toBe(20);

    const mp = c.components.find((x) => x.key === 'rawMaterial')!;
    expect(mp.delta).toBe(160000);
    expect(mp.contributionPct).toBe(80); // "el 80% vino de la materia prima"

    const suma = c.components.reduce((a, x) => a + (x.contributionPct ?? 0), 0);
    expect(suma).toBeCloseTo(100, 6);
    expect(c.offsetting).toBe(false);
  });

  it('una baja da contribución NEGATIVA (bajar el costo no "explica una suba")', () => {
    const c = comparePeriods(
      junio,
      side({ code: '2026-07', label: 'Julio 2026', result: result({ mp: 760000, mod: 230000, cif: 150000 }) }),
    );
    const mod = c.components.find((x) => x.key === 'directLabor')!;
    expect(mod.delta).toBe(-20000);
    expect(mod.contributionPct).toBeLessThan(0);
    expect(c.components.reduce((a, x) => a + (x.contributionPct ?? 0), 0)).toBeCloseTo(100, 6);
  });

  it('si las subas y las bajas se cancelan, lo dice en vez de escupir porcentajes locos', () => {
    const c = comparePeriods(
      junio,
      // MP +100.000, MOD −100.000: el total no se mueve, pero por dentro pasó de todo.
      side({ code: '2026-07', label: 'Julio 2026', result: result({ mp: 700000, mod: 150000, cif: 150000 }) }),
    );
    expect(c.total.productionCost.delta).toBe(0);
    expect(c.offsetting).toBe(true);
    expect(c.warnings.join(' ')).toMatch(/se cancelaron/i);
    // Reparto sobre valores absolutos: 100.000 de 200.000 = 50% cada uno.
    expect(c.components.find((x) => x.key === 'rawMaterial')!.contributionPct).toBe(50);
    expect(c.components.find((x) => x.key === 'directLabor')!.contributionPct).toBe(-50);
  });

  it('no inventa un % de suba cuando el mes base era cero', () => {
    const c = comparePeriods(
      side({ code: '2026-06', label: 'Junio', result: result({ mp: 0, mod: 0, cif: 0 }) }),
      side({ code: '2026-07', label: 'Julio', result: result({ mp: 500, mod: 0, cif: 0 }) }),
    );
    expect(c.total.rawMaterial.deltaPct).toBeNull();
    expect(c.total.rawMaterial.delta).toBe(500);
  });
});

describe('COMPARACIÓN — materia prima: ¿precio o consumo?', () => {
  /**
   * La chapa: en junio se consumieron 200 kg a $1.000 → $200.000.
   * En julio, 220 kg a $1.200 → $264.000.
   *
   * ΔValor = $64.000, y se abre así:
   *   efecto PRECIO   = (1.200 − 1.000) × 220 = $44.000
   *   efecto CONSUMO  = (220 − 200) × 1.000   = $20.000
   *   ---------------------------------------------------
   *                                    suma  = $64.000  ✓ cierra exacto
   *
   * O sea: la chapa subió $64.000 y DOS TERCIOS fueron el país, no la planta.
   */
  const junio = side({
    code: '2026-06',
    label: 'Junio',
    result: result({ mp: 200000, mod: 0, cif: 0, materials: [{ name: 'Chapa', consumed: 200000 }] }),
    consumos: [{ name: 'Chapa', consumed: 200 }],
  });
  const julio = side({
    code: '2026-07',
    label: 'Julio',
    result: result({ mp: 264000, mod: 0, cif: 0, materials: [{ name: 'Chapa', consumed: 264000 }] }),
    consumos: [{ name: 'Chapa', consumed: 220 }],
  });

  it('🔑 abre la variación en precio y consumo, y la identidad cierra al centavo', () => {
    const chapa = comparePeriods(junio, julio).materials[0]!;

    expect(chapa.label).toBe('Chapa');
    expect(chapa.qtyA).toBe(200);
    expect(chapa.qtyB).toBe(220);
    expect(chapa.priceA).toBe(1000);
    expect(chapa.priceB).toBe(1200);

    expect(chapa.delta).toBe(64000);
    expect(chapa.priceEffect).toBe(44000);
    expect(chapa.quantityEffect).toBe(20000);

    // La identidad: precio + consumo = la variación entera. Sin resto.
    expect(chapa.priceEffect + chapa.quantityEffect).toBe(chapa.delta);
  });

  it('la identidad cierra también con precios de muchos decimales (el PPP no es redondo)', () => {
    // PPP feo a propósito: 1.163,333333... por kg. Con floats esto no cierra.
    const a = side({
      code: '2026-06',
      label: 'Junio',
      result: result({ mp: 349000, mod: 0, cif: 0, materials: [{ name: 'Chapa', consumed: 349000 }] }),
      consumos: [{ name: 'Chapa', consumed: 300 }],
    });
    const b = side({
      code: '2026-07',
      label: 'Julio',
      result: result({ mp: 411111.11, mod: 0, cif: 0, materials: [{ name: 'Chapa', consumed: 411111.11 }] }),
      consumos: [{ name: 'Chapa', consumed: 337 }],
    });

    const chapa = comparePeriods(a, b).materials[0]!;
    expect(chapa.priceEffect + chapa.quantityEffect).toBeCloseTo(chapa.delta, 2);
  });

  it('una MP nueva es todo consumo: no hay precio viejo contra el cual compararla', () => {
    const a = side({
      code: '2026-06',
      label: 'Junio',
      result: result({ mp: 0, mod: 0, cif: 0, materials: [] }),
      consumos: [],
    });
    const b = side({
      code: '2026-07',
      label: 'Julio',
      result: result({ mp: 50000, mod: 0, cif: 0, materials: [{ name: 'Aluminio', consumed: 50000 }] }),
      consumos: [{ name: 'Aluminio', consumed: 100 }],
    });

    const al = comparePeriods(a, b).materials[0]!;
    expect(al.presence).toBe('new');
    expect(al.priceA).toBeNull();
    expect(al.priceEffect).toBe(0);
    expect(al.quantityEffect).toBe(50000);
    expect(al.priceEffect + al.quantityEffect).toBe(al.delta);
  });

  it('ordena por el peso de la variación: primero la que más movió la aguja', () => {
    const a = side({
      code: '2026-06',
      label: 'Junio',
      result: result({
        mp: 300000, mod: 0, cif: 0,
        materials: [{ name: 'Chapa', consumed: 100000 }, { name: 'Pintura', consumed: 200000 }],
      }),
      consumos: [{ name: 'Chapa', consumed: 100 }, { name: 'Pintura', consumed: 200 }],
    });
    const b = side({
      code: '2026-07',
      label: 'Julio',
      result: result({
        mp: 450000, mod: 0, cif: 0,
        materials: [{ name: 'Chapa', consumed: 110000 }, { name: 'Pintura', consumed: 340000 }],
      }),
      consumos: [{ name: 'Chapa', consumed: 100 }, { name: 'Pintura', consumed: 200 }],
    });

    const [primera, segunda] = comparePeriods(a, b).materials;
    expect(primera!.label).toBe('Pintura'); // +140.000
    expect(segunda!.label).toBe('Chapa'); //  +10.000
  });

  it('cuenta las unidades consumidas del mes desde los movimientos de la ficha', () => {
    const qty = consumedQuantitiesOf({
      materials: [
        {
          name: 'Chapa',
          movements: [
            { type: 'purchase', quantity: 400 }, // una compra NO es un consumo
            { type: 'consumption', quantity: 120 },
            { type: 'consumption', quantity: 80 },
          ],
        },
      ],
    });
    expect(qty.get('Chapa')!.toNumber()).toBe(200);
  });
});

describe('COMPARACIÓN — el costo por unidad', () => {
  it('el total sube pero el costo por unidad BAJA: producir más no es encarecerse', () => {
    // Junio: $1.000.000 / 100 u = $10.000 por unidad.
    // Julio: $1.400.000 / 200 u = $7.000 por unidad. El total subió 40%, el unitario bajó 30%.
    const c = comparePeriods(
      side({ code: '2026-06', label: 'Junio', result: result({ mp: 600000, mod: 250000, cif: 150000 }), units: 100 }),
      side({ code: '2026-07', label: 'Julio', result: result({ mp: 900000, mod: 300000, cif: 200000 }), units: 200 }),
    );

    expect(c.total.productionCost.deltaPct).toBe(40);
    expect(c.unit!.productionCost.a).toBe(10000);
    expect(c.unit!.productionCost.b).toBe(7000);
    expect(c.unit!.productionCost.deltaPct).toBe(-30);

    // Y avisa que hay que mirar el unitario, porque el volumen cambió mucho.
    expect(c.warnings.join(' ')).toMatch(/por unidad/i);
    expect(c.units.comparable).toBe(true);
  });

  it('sin cantidad producida no hay costo unitario: lo dice, no divide por cero', () => {
    const c = comparePeriods(
      side({ code: '2026-06', label: 'Junio', result: result({ mp: 1, mod: 0, cif: 0 }), units: 0 }),
      side({ code: '2026-07', label: 'Julio', result: result({ mp: 2, mod: 0, cif: 0 }), units: 100 }),
    );
    expect(c.unit).toBeNull();
    expect(c.componentsUnit).toBeNull();
    expect(c.units.comparable).toBe(false);
    expect(c.warnings.join(' ')).toMatch(/cantidad producida/i);
  });
});

describe('COMPARACIÓN — de dónde salieron los números', () => {
  it('avisa si un mes cerrado tuvo que recalcularse (no estaba congelado)', () => {
    const c = comparePeriods(
      side({ code: '2026-06', label: 'Junio', result: result({ mp: 1, mod: 0, cif: 0 }), source: 'recomputed' }),
      side({ code: '2026-07', label: 'Julio', result: result({ mp: 2, mod: 0, cif: 0 }) }),
    );
    expect(c.from.source).toBe('recomputed');
    expect(c.warnings.join(' ')).toMatch(/recalcularon|recalculado/i);
  });

  it('avisa que un mes abierto todavía se mueve', () => {
    const c = comparePeriods(
      side({ code: '2026-06', label: 'Junio', result: result({ mp: 1, mod: 0, cif: 0 }) }),
      side({ code: '2026-07', label: 'Julio', result: result({ mp: 2, mod: 0, cif: 0 }), status: 'OPEN', source: 'recomputed' }),
    );
    expect(c.warnings.join(' ')).toMatch(/todavía está abierto/i);
  });

  it('el CIF por centro sale con el NOMBRE del centro, no con su id interno', () => {
    const c = comparePeriods(
      side({ code: '2026-06', label: 'Junio', result: result({ mp: 0, mod: 0, cif: 100000, centers: { corte: 60000, armado: 40000 } }) }),
      side({ code: '2026-07', label: 'Julio', result: result({ mp: 0, mod: 0, cif: 130000, centers: { corte: 90000, armado: 40000 } }) }),
    );
    expect(c.centers[0]!.label).toBe('Corte');
    expect(c.centers[0]!.delta).toBe(30000);
    expect(c.centers[0]!.contributionPct).toBe(100); // toda la suba del CIF fue Corte
  });
});
