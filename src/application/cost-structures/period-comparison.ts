import { Decimal } from 'decimal.js';
import type { FrozenCalculation } from '../../domain/calculations/calculate.js';
import { materialsOf } from '../../domain/periods/closing-stock.js';

/**
 * COMPARACIÓN ENTRE PERÍODOS (problema C — Fase 4).
 *
 * Responde la pregunta que justifica todo el modelo de períodos:
 *
 *   "El costo unitario subió 12% de mayo a junio. ¿De dónde vino ese 12%?"
 *
 * Y la responde en tres niveles:
 *
 *   1. De los tres elementos del costo: ¿cuánto puso la MP, cuánto la MOD,
 *      cuánto el CIF? La suma de los tres es, exactamente, la variación total.
 *   2. ¿Qué materia prima, qué departamento, qué centro concreto la movió?
 *   3. Y en la materia prima, la pregunta que en Argentina lo es todo:
 *      ¿subió porque el PRECIO subió, o porque CONSUMIMOS más?
 *
 * Ese tercer nivel es lo que separa la inflación del desperdicio. Un costista
 * que ve "la chapa subió $500.000" no sabe qué hacer; uno que ve "$480.000 fue
 * precio y $20.000 fue consumo" sabe que no es un problema de planta, es el país.
 * (Es, además, lo que va a alimentar la "variación costos país" — problema B.)
 *
 * Módulo PURO: recibe los dos resultados ya calculados, devuelve la comparación.
 * No toca base de datos. Toda la aritmética pasa por Decimal: comparar plata con
 * floats es cómo se fabrica un "+0,1%" que no existe.
 */

/** Un lado de la comparación: un período con su resultado ya resuelto. */
export interface PeriodSide {
  code: string;
  label: string;
  status: 'OPEN' | 'CLOSED';
  /**
   * De dónde salieron los números:
   *   · `frozen`      — congelados al cerrar el mes. Son EL número del mes.
   *   · `recomputed`  — recalculados ahora con el motor de hoy, porque el período
   *     está abierto o se cerró antes de que el cierre congelara resultados.
   *     Se marca para no hacerlos pasar por lo que no son.
   */
  source: 'frozen' | 'recomputed';
  result: FrozenCalculation;
  /** Config de MP del período: de acá sale CUÁNTAS unidades se consumieron. */
  rawMaterialConfig: unknown;
  /** Config de CIF: de acá salen los NOMBRES de los centros (el motor solo da ids). */
  indirectCostConfig: unknown;
  /** Unidades PRODUCIDAS del mes (0 o null si no se cargaron). */
  units: number | null;
  /**
   * Las `units` no son las producidas: son las VENDIDAS, porque el período es viejo
   * y no tiene el dato de producción. El costo unitario sale igual, pero queda
   * dividido por lo vendido — y se avisa, en vez de hacerlo pasar por exacto.
   */
  unitsAreSales?: boolean;
}

export interface Delta {
  a: number;
  b: number;
  delta: number;
  /** null cuando el mes base es cero: no existe "subió un %" desde la nada. */
  deltaPct: number | null;
}

export interface LineDelta extends Delta {
  key: string;
  label: string;
  /** Qué parte de la variación TOTAL explica esta línea ("el 80% vino de la MP"). */
  contributionPct: number | null;
  /** Apareció o desapareció entre los dos meses (se compara contra cero). */
  presence?: 'new' | 'removed';
}

/** Una materia prima, con la variación abierta en precio y consumo. */
export interface MaterialDelta extends LineDelta {
  unit: string | null;
  qtyA: number;
  qtyB: number;
  /** Costo unitario al que se consumió (PPP). null si no hubo consumo ese mes. */
  priceA: number | null;
  priceB: number | null;
  /** Lo que subió porque el insumo está más caro. */
  priceEffect: number;
  /** Lo que subió porque se consumió más cantidad. */
  quantityEffect: number;
}

export interface PeriodComparison {
  from: PeriodRef;
  to: PeriodRef;
  units: { from: number | null; to: number | null; comparable: boolean };
  /** Los números del mes completo. */
  total: Totals;
  /** Los mismos números divididos por unidad producida. null si falta la cantidad. */
  unit: Totals | null;
  /** MP / MOD / CIF sobre el total del mes. */
  components: LineDelta[];
  /** MP / MOD / CIF por unidad. null si falta la cantidad producida. */
  componentsUnit: LineDelta[] | null;
  materials: MaterialDelta[];
  departments: LineDelta[];
  centers: LineDelta[];
  /**
   * Las subas y las bajas se cancelaron entre sí: la variación total quedó casi
   * en cero aunque por dentro se movió todo. Los porcentajes de contribución se
   * calculan sobre la suma de los valores absolutos, y se avisa.
   */
  offsetting: boolean;
  warnings: string[];
}

export interface PeriodRef {
  code: string;
  label: string;
  status: 'OPEN' | 'CLOSED';
  source: 'frozen' | 'recomputed';
}

export interface Totals {
  rawMaterial: Delta;
  directLabor: Delta;
  indirectCosts: Delta;
  productionCost: Delta;
  costOfGoodsSold: Delta;
  grossMargin: Delta;
}

const ZERO = new Decimal(0);
/** Dos meses idénticos no dan exactamente 0 en float: bajo este umbral, es cero. */
const EPSILON = new Decimal('0.005');

const num = (d: Decimal): number => d.toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN).toNumber();
const pct = (d: Decimal): number => d.toDecimalPlaces(4, Decimal.ROUND_HALF_EVEN).toNumber();

/** Variación entre dos importes. El % no existe si el mes base era cero. */
function delta(a: Decimal, b: Decimal): { d: Decimal; out: Delta } {
  const d = b.minus(a);
  return {
    d,
    out: {
      a: num(a),
      b: num(b),
      delta: num(d),
      deltaPct: a.isZero() ? null : pct(d.dividedBy(a.abs()).times(100)),
    },
  };
}

/**
 * Reparte la responsabilidad de la variación total entre las líneas.
 *
 * Normalmente cada línea explica `su variación ÷ variación total`. Pero si las
 * subas y las bajas se cancelan (total ≈ 0), esa división explota y devuelve
 * porcentajes de 4 cifras que no significan nada. En ese caso se reparte sobre la
 * suma de los valores absolutos y se avisa (`offsetting`): el mes no "quedó
 * igual", se movió mucho en direcciones opuestas.
 */
function assignContributions(lines: LineDelta[], deltas: Decimal[], totalDelta: Decimal): boolean {
  const offsetting = totalDelta.abs().lessThan(EPSILON);
  const base = offsetting
    ? deltas.reduce((acc, d) => acc.plus(d.abs()), ZERO)
    : totalDelta.abs();

  lines.forEach((line, i) => {
    line.contributionPct = base.isZero() ? null : pct(deltas[i]!.dividedBy(base).times(100));
  });

  return offsetting;
}

/**
 * Cuántas unidades de cada materia prima se consumieron en el período.
 *
 * Sale de los MOVIMIENTOS de la ficha (los de tipo `consumption`), que es el dato
 * que el costista cargó. El motor devuelve el consumo VALORIZADO ($), no las
 * unidades; para abrir la variación en precio y cantidad hacen falta las dos.
 */
export function consumedQuantitiesOf(rawMaterialConfig: unknown): Map<string, Decimal> {
  const out = new Map<string, Decimal>();
  materialsOf(rawMaterialConfig).forEach((m, i) => {
    const movements = (m as { movements?: { type?: string; quantity?: number }[] }).movements ?? [];
    const qty = movements
      .filter((mv) => mv.type === 'consumption')
      .reduce((acc, mv) => acc.plus(new Decimal(mv.quantity ?? 0)), ZERO);
    out.set(materialKey(m, i), qty);
  });
  return out;
}

/**
 * Con qué identificamos a la misma materia prima en dos meses distintos.
 *
 * El código de mercado es lo más estable (es el que usa el proveedor); si no hay,
 * el nombre. La posición en la lista es el último recurso: si el costista reordena
 * las MP entre meses, comparar por posición compararía la chapa contra el aluminio.
 */
function materialKey(m: { code?: string; name?: string; id?: string }, index: number): string {
  return m.code ?? m.name ?? m.id ?? `#${index}`;
}

/** id de centro → nombre, tal como lo tiene la config del período. */
function centerNamesOf(indirectCostConfig: unknown): Map<string, string> {
  const cfg = indirectCostConfig as { centers?: { id?: string; name?: string }[] } | null;
  const out = new Map<string, string>();
  for (const c of cfg?.centers ?? []) {
    if (c.id && c.name) out.set(c.id, c.name);
  }
  return out;
}

/** Empareja dos listas por clave, tolerando altas y bajas entre meses. */
function pairByKey<T>(
  a: Map<string, T>,
  b: Map<string, T>,
): { key: string; a: T | undefined; b: T | undefined; presence?: 'new' | 'removed' }[] {
  const keys = [...new Set([...a.keys(), ...b.keys()])];
  return keys.map((key) => {
    const inA = a.has(key);
    const inB = b.has(key);
    return {
      key,
      a: a.get(key),
      b: b.get(key),
      presence: !inA ? ('new' as const) : !inB ? ('removed' as const) : undefined,
    };
  });
}

export function comparePeriods(from: PeriodSide, to: PeriodSide): PeriodComparison {
  const warnings: string[] = [];

  // ── Los tres elementos del costo, sobre el total del mes.
  const mp = delta(new Decimal(from.result.rawMaterialConsumed), new Decimal(to.result.rawMaterialConsumed));
  const mod = delta(new Decimal(from.result.directLaborTotal), new Decimal(to.result.directLaborTotal));
  const cif = delta(new Decimal(from.result.indirectCostsApplied), new Decimal(to.result.indirectCostsApplied));
  const prod = delta(new Decimal(from.result.productionCost), new Decimal(to.result.productionCost));

  const components: LineDelta[] = [
    { key: 'rawMaterial', label: 'Materia prima', ...mp.out, contributionPct: null },
    { key: 'directLabor', label: 'Mano de obra directa', ...mod.out, contributionPct: null },
    { key: 'indirectCosts', label: 'Costos indirectos (CIF)', ...cif.out, contributionPct: null },
  ];
  // La suma de los tres ES la variación del costo de producción: repartimos sobre
  // esa suma y no sobre `productionCost`, que puede traer redondeos del estado de
  // costos y dejaría las contribuciones sin cerrar en 100%.
  const sumOfComponents = mp.d.plus(mod.d).plus(cif.d);
  const offsetting = assignContributions(components, [mp.d, mod.d, cif.d], sumOfComponents);
  if (offsetting) {
    warnings.push(
      'Las subas y las bajas casi se cancelaron: el costo total quedó parecido, pero por dentro se movió. ' +
        'Los porcentajes muestran cuánto se movió cada elemento, no cuánto explica del total.',
    );
  }

  const total: Totals = {
    rawMaterial: mp.out,
    directLabor: mod.out,
    indirectCosts: cif.out,
    productionCost: prod.out,
    costOfGoodsSold: delta(
      new Decimal(from.result.costOfGoodsSold),
      new Decimal(to.result.costOfGoodsSold),
    ).out,
    grossMargin: delta(new Decimal(from.result.grossMargin), new Decimal(to.result.grossMargin)).out,
  };

  // ── El plano POR UNIDAD. Es la comparación honesta: el total sube solo con
  //    producir más, y eso no es que algo "esté más caro".
  const unitsA = from.units && from.units > 0 ? new Decimal(from.units) : null;
  const unitsB = to.units && to.units > 0 ? new Decimal(to.units) : null;
  const comparable = unitsA !== null && unitsB !== null;

  let unit: Totals | null = null;
  let componentsUnit: LineDelta[] | null = null;

  if (comparable) {
    const per = (a: number, b: number) =>
      delta(new Decimal(a).dividedBy(unitsA!), new Decimal(b).dividedBy(unitsB!));

    const mpU = per(from.result.rawMaterialConsumed, to.result.rawMaterialConsumed);
    const modU = per(from.result.directLaborTotal, to.result.directLaborTotal);
    const cifU = per(from.result.indirectCostsApplied, to.result.indirectCostsApplied);

    componentsUnit = [
      { key: 'rawMaterial', label: 'Materia prima', ...mpU.out, contributionPct: null },
      { key: 'directLabor', label: 'Mano de obra directa', ...modU.out, contributionPct: null },
      { key: 'indirectCosts', label: 'Costos indirectos (CIF)', ...cifU.out, contributionPct: null },
    ];
    assignContributions(componentsUnit, [mpU.d, modU.d, cifU.d], mpU.d.plus(modU.d).plus(cifU.d));

    unit = {
      rawMaterial: mpU.out,
      directLabor: modU.out,
      indirectCosts: cifU.out,
      productionCost: per(from.result.productionCost, to.result.productionCost).out,
      costOfGoodsSold: per(from.result.costOfGoodsSold, to.result.costOfGoodsSold).out,
      grossMargin: per(from.result.grossMargin, to.result.grossMargin).out,
    };

    const volume = new Decimal(to.units!).minus(from.units!).dividedBy(unitsA!).abs();
    if (volume.greaterThan('0.10')) {
      warnings.push(
        `La producción cambió ${pct(volume.times(100))}% entre los dos meses: mirá el costo POR UNIDAD, ` +
          'no el total. El total sube por producir más, aunque nada se haya encarecido.',
      );
    }
    if (from.unitsAreSales || to.unitsAreSales) {
      warnings.push(
        'El costo por unidad está dividido por las unidades VENDIDAS, no por las producidas: ' +
          'alguno de los dos meses no tiene cargada la cantidad producida. Si se produjo más de lo que se ' +
          'vendió, el costo unitario que ves está inflado. Cargá la cantidad producida en la sección de Venta.',
      );
    }
  } else {
    warnings.push(
      'No se puede mostrar el costo por unidad: falta la cantidad producida (o la vendida) en alguno de los ' +
        'dos períodos. Cargala en la sección de Venta y la comparación se completa sola.',
    );
  }

  // ── Nivel 2 y 3: materia prima, con la variación abierta en precio y consumo.
  const materials = compareMaterials(from, to, sumOfComponents);
  const departments = compareDepartments(from, to, mod.d);
  const centers = compareCenters(from, to, cif.d);

  if (from.source === 'recomputed' && from.status === 'CLOSED') {
    warnings.push(
      `"${from.label}" se cerró antes de que el sistema congelara resultados: sus números se recalcularon ` +
        'ahora con el motor actual. Cerralo de nuevo (reabrir → cerrar) para dejarlos fijos.',
    );
  }
  if (to.status === 'OPEN') {
    warnings.push(
      `"${to.label}" todavía está abierto: sus números se van a mover hasta que lo cierres.`,
    );
  }

  return {
    from: { code: from.code, label: from.label, status: from.status, source: from.source },
    to: { code: to.code, label: to.label, status: to.status, source: to.source },
    units: { from: from.units ?? null, to: to.units ?? null, comparable },
    total,
    unit,
    components,
    componentsUnit,
    materials,
    departments,
    centers,
    offsetting,
    warnings,
  };
}

/**
 * Materia prima: la variación se abre en PRECIO y CONSUMO.
 *
 *   ΔValor = (P₁ − P₀) × Q₁   +   (Q₁ − Q₀) × P₀
 *            └── precio ──┘       └── consumo ──┘
 *
 * La identidad cierra EXACTA (por eso Decimal y no float): las dos partes suman,
 * al centavo, la variación del consumo valorizado. Si no cerrara, el número sería
 * una opinión, no una explicación.
 *
 * Si la MP no se consumió el mes anterior (Q₀ = 0), no hay precio viejo contra el
 * cual comparar: todo el movimiento es consumo.
 */
function compareMaterials(from: PeriodSide, to: PeriodSide, totalDelta: Decimal): MaterialDelta[] {
  const qtyA = consumedQuantitiesOf(from.rawMaterialConfig);
  const qtyB = consumedQuantitiesOf(to.rawMaterialConfig);

  const valA = new Map<string, { value: Decimal; name: string; unit: string | null }>();
  const valB = new Map<string, { value: Decimal; name: string; unit: string | null }>();

  from.result.detail.rawMaterial.materials.forEach((m, i) =>
    valA.set(materialKey(m, i), {
      value: new Decimal(m.consumed),
      name: m.name ?? m.code ?? `Materia prima ${i + 1}`,
      unit: m.unit ?? null,
    }),
  );
  to.result.detail.rawMaterial.materials.forEach((m, i) =>
    valB.set(materialKey(m, i), {
      value: new Decimal(m.consumed),
      name: m.name ?? m.code ?? `Materia prima ${i + 1}`,
      unit: m.unit ?? null,
    }),
  );

  const pairs = pairByKey(valA, valB);
  const deltas: Decimal[] = [];

  const lines: MaterialDelta[] = pairs.map(({ key, a, b, presence }) => {
    const v0 = a?.value ?? ZERO;
    const v1 = b?.value ?? ZERO;
    const q0 = qtyA.get(key) ?? ZERO;
    const q1 = qtyB.get(key) ?? ZERO;

    // Precio implícito: a cuánto salió cada unidad consumida ese mes (el PPP con
    // el que el motor valuó las salidas). Sin consumo no hay precio que mostrar.
    const p0 = q0.isZero() ? null : v0.dividedBy(q0);
    const p1 = q1.isZero() ? null : v1.dividedBy(q1);

    // Sin precio viejo (no se consumió el mes pasado) no hay efecto precio posible:
    // todo lo que aparece es consumo nuevo.
    const priceEffect = p0 === null || p1 === null ? ZERO : p1.minus(p0).times(q1);
    const quantityEffect = p0 === null ? v1.minus(v0) : q1.minus(q0).times(p0);

    const d = delta(v0, v1);
    deltas.push(d.d);

    return {
      key,
      label: b?.name ?? a?.name ?? key,
      unit: b?.unit ?? a?.unit ?? null,
      ...d.out,
      contributionPct: null,
      presence,
      qtyA: q0.toDecimalPlaces(4).toNumber(),
      qtyB: q1.toDecimalPlaces(4).toNumber(),
      // El PPP con 6 decimales, como el arrastre: un centavo por unidad, sobre
      // miles de unidades, deja de ser un centavo.
      priceA: p0 === null ? null : p0.toDecimalPlaces(6).toNumber(),
      priceB: p1 === null ? null : p1.toDecimalPlaces(6).toNumber(),
      priceEffect: num(priceEffect),
      quantityEffect: num(quantityEffect),
    };
  });

  assignContributions(lines, deltas, totalDelta);
  return lines.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
}

/** Mano de obra por departamento (se emparejan por nombre). */
function compareDepartments(from: PeriodSide, to: PeriodSide, totalDelta: Decimal): LineDelta[] {
  const a = new Map<string, Decimal>();
  const b = new Map<string, Decimal>();
  from.result.detail.directLabor.departments.forEach((d) => a.set(d.name, new Decimal(d.totalMod)));
  to.result.detail.directLabor.departments.forEach((d) => b.set(d.name, new Decimal(d.totalMod)));

  const deltas: Decimal[] = [];
  const lines: LineDelta[] = pairByKey(a, b).map(({ key, a: va, b: vb, presence }) => {
    const d = delta(va ?? ZERO, vb ?? ZERO);
    deltas.push(d.d);
    return { key, label: key, ...d.out, contributionPct: null, presence };
  });

  assignContributions(lines, deltas, totalDelta);
  return lines.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
}

/**
 * CIF por centro de costo. Se emparejan por `centerId`, que es la clave estable:
 * sobrevive al arrastre de la receta aunque al centro le cambien el nombre.
 */
function compareCenters(from: PeriodSide, to: PeriodSide, totalDelta: Decimal): LineDelta[] {
  const a = new Map<string, Decimal>();
  const b = new Map<string, Decimal>();
  for (const [id, c] of Object.entries(from.result.detail.indirectCosts.perDepartment)) {
    a.set(id, new Decimal(c.appliedCip));
  }
  for (const [id, c] of Object.entries(to.result.detail.indirectCosts.perDepartment)) {
    b.set(id, new Decimal(c.appliedCip));
  }

  // El nombre lo pone el mes más nuevo: si al centro lo renombraron, el costista
  // busca el nombre que usa hoy, no el de hace tres meses.
  const names = new Map([...centerNamesOf(from.indirectCostConfig), ...centerNamesOf(to.indirectCostConfig)]);

  const deltas: Decimal[] = [];
  const lines: LineDelta[] = pairByKey(a, b).map(({ key, a: va, b: vb, presence }) => {
    const d = delta(va ?? ZERO, vb ?? ZERO);
    deltas.push(d.d);
    return { key, label: names.get(key) ?? key, ...d.out, contributionPct: null, presence };
  });

  assignContributions(lines, deltas, totalDelta);
  return lines.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
}
