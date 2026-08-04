import { Decimal } from 'decimal.js';
import type { FrozenCalculation } from '../../domain/calculations/calculate.js';
import { consumedQuantitiesOf, materialKey } from '../cost-structures/period-comparison.js';

/**
 * DETECCIÓN DE ANOMALÍAS (F7.1).
 *
 * Responde una pregunta distinta a la de `period-comparison.ts`. Aquella compara
 * DOS períodos y explica la variación; ésta mira UN período contra lo que la
 * estructura venía siendo, y decide si hay algo que merezca interrumpir al
 * costista.
 *
 * Tres señales, y la diferencia entre ellas importa:
 *
 *   · S1 MIX_DEVIATION  — la participación de un elemento sobre el costo total se
 *     movió más de X PUNTOS contra su media móvil. Necesita historia.
 *   · S2 UNIT_COST_JUMP — el costo POR UNIDAD (del total, de cada elemento, o el
 *     precio implícito de una materia prima) se desvió más de X% de su media
 *     móvil. Necesita historia.
 *   · S3 CIF_VARIANCE   — las variaciones de CIF que el motor ya calcula
 *     (sub/sobreaplicación, presupuesto, volumen) contra el presupuesto del
 *     propio período. NO necesita historia: funciona desde el primer período.
 *
 * TRES REGLAS que gobiernan el módulo:
 *
 *  1. NUNCA POR IMPORTE TOTAL. Un período que produjo el doble tiene el doble de
 *     costo y no pasó nada raro. Y con ciclos configurables (F1) un período de 10
 *     días contra uno de 15 no es comparable en total. La participación % es
 *     invariante a la escala y el costo unitario está normalizado por producción:
 *     esas dos bases sirven, el importe no.
 *  2. SIN HISTORIA NO SE ALERTA, Y SE DICE. Con menos de `minPeriods` cerrados no
 *     hay media móvil: hay un número anterior, que no es lo mismo. La media de una
 *     sola observación convierte cualquier segundo período en anomalía. Lo que no
 *     se pudo evaluar sale en `skipped` con el motivo, para que la pantalla diga
 *     "van 1 de 3 períodos" en vez de "todo tranquilo".
 *  3. MÓDULO PURO. No toca base de datos ni Prisma, igual que `period-comparison`.
 *     Toda la aritmética por `Decimal`: comparar plata con floats es cómo se
 *     fabrica un desvío de "+0,1%" que no existe.
 */

export type AnomalySignal = 'MIX_DEVIATION' | 'UNIT_COST_JUMP' | 'CIF_VARIANCE';

export interface AnomalyThresholds {
  /** S1: puntos de participación contra la media móvil. */
  mixDeviationPoints: number;
  /** S2: % de desvío del costo unitario contra la media móvil. */
  unitCostJumpPct: number;
  /** S3: la variación de CIF, como % del CIF aplicado del centro. */
  cifVariancePct: number;
  /** Cuántos períodos cerrados entran en la media móvil, como máximo. */
  lookbackPeriods: number;
  /** Por debajo de esto, S1 y S2 no se evalúan. */
  minPeriods: number;
}

/**
 * Los valores de arranque. NO son definitivos: se calibran contra datos reales
 * antes de encender los emails. Un detector mal calibrado no es neutro — enseña a
 * ignorar las alertas, y eso sale más caro que no tenerlas.
 */
export const DEFAULT_ANOMALY_THRESHOLDS: AnomalyThresholds = {
  mixDeviationPoints: 10,
  unitCostJumpPct: 20,
  cifVariancePct: 5,
  lookbackPeriods: 6,
  minPeriods: 3,
};

/** Un período con su resultado ya calculado. La historia son períodos CERRADOS. */
export interface AnomalyPeriod {
  code: string;
  label: string;
  result: FrozenCalculation;
  /**
   * Unidades PRODUCIDAS. `null` si no se cargaron: entonces S2 no se evalúa y se
   * dice por qué, en lugar de dividir por lo que haya a mano.
   */
  units: number | null;
  /** Ficha de MP del período: de acá salen las CANTIDADES consumidas (para el precio implícito). */
  rawMaterialConfig?: unknown;
  /** Config de CIF: de acá salen los NOMBRES de los centros (el motor solo da ids). */
  indirectCostConfig?: unknown;
}

export interface AnomalyInput {
  current: AnomalyPeriod;
  /** Períodos cerrados anteriores, del MÁS NUEVO al más viejo. */
  history: AnomalyPeriod[];
  thresholds?: Partial<AnomalyThresholds>;
}

export interface AnomalyFinding {
  signal: AnomalySignal;
  /** Clave estable del concepto: 'rawMaterial' | 'directLabor' | 'indirectCosts' | 'productionCost' | clave de MP | id de centro. */
  conceptKey: string;
  conceptLabel: string;
  severity: 'info' | 'warn' | 'critical';
  /** El valor del período: % de participación (S1), $ por unidad (S2), $ (S3). */
  actual: number;
  /** La media móvil. `null` en S3: ahí no hay media, hay presupuesto. */
  baseline: number | null;
  /** Puntos de participación (S1) o % (S2 y S3). Con signo: (+) subió. */
  deviation: number;
  /** En castellano, para el costista. Sin ids ni endpoints. */
  message: string;
  /** El respaldo del número: sin esto la alerta es una afirmación sin evidencia. */
  explanation: string[];
  /** Cuántos períodos entraron en la media. 0 en S3. */
  periodsUsed: number;
}

export interface AnomalyReport {
  findings: AnomalyFinding[];
  /**
   * Lo que NO se pudo evaluar y por qué. Es tan importante como los hallazgos:
   * una pantalla que dice "todo tranquilo" cuando en realidad no miró nada miente
   * sobre su propia cobertura.
   */
  skipped: { signal: AnomalySignal; reason: string }[];
  periodsAvailable: number;
  periodsRequired: number;
}

// ---------------------------------------------------------------------------
// Formato de números — en castellano y determinístico (sin `toLocaleString`, que
// depende del ICU que tenga el runtime y haría que un test pase acá y falle en CI).
// ---------------------------------------------------------------------------

const ZERO = new Decimal(0);

function fmt(value: Decimal | number, decimals: number): string {
  const d = new Decimal(value).toDecimalPlaces(decimals, Decimal.ROUND_HALF_EVEN);
  const neg = d.isNegative();
  const [int, dec] = d.abs().toFixed(decimals).split('.');
  const grouped = int!.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${neg ? '−' : ''}${grouped}${dec ? `,${dec}` : ''}`;
}

const pct = (v: Decimal | number): string => `${fmt(v, 1)}%`;
const money = (v: Decimal | number): string => `$${fmt(v, 2)}`;
/** El precio unitario con más decimales: un centavo por unidad, sobre miles de unidades, deja de ser un centavo. */
const price = (v: Decimal | number): string => `$${fmt(v, 4)}`;

const round = (v: Decimal, decimals = 4): number =>
  v.toDecimalPlaces(decimals, Decimal.ROUND_HALF_EVEN).toNumber();

/** El promedio simple. `null` si no hay observaciones (no existe la media de nada). */
function mean(values: Decimal[]): Decimal | null {
  if (values.length === 0) return null;
  return values.reduce((acc, v) => acc.plus(v), ZERO).dividedBy(values.length);
}

/**
 * Cuán grave es. Pasado el umbral es `warn`; al doble del umbral, `critical`.
 *
 * Deliberadamente grueso: la gravedad ordena la bandeja, no pretende medir nada.
 * Una escala fina acá sugeriría una precisión que el método —una media móvil de
 * seis observaciones— no tiene.
 */
function severityOf(deviation: Decimal, threshold: number): 'warn' | 'critical' {
  return deviation.abs().greaterThanOrEqualTo(threshold * 2) ? 'critical' : 'warn';
}

const ELEMENTS = [
  { key: 'rawMaterial', label: 'Materia prima', of: (r: FrozenCalculation) => r.rawMaterialConsumed },
  { key: 'directLabor', label: 'Mano de obra directa', of: (r: FrozenCalculation) => r.directLaborTotal },
  { key: 'indirectCosts', label: 'Costos indirectos (CIF)', of: (r: FrozenCalculation) => r.indirectCostsApplied },
] as const;

// ---------------------------------------------------------------------------
// El detector
// ---------------------------------------------------------------------------

export function detectAnomalies(input: AnomalyInput): AnomalyReport {
  const thresholds: AnomalyThresholds = { ...DEFAULT_ANOMALY_THRESHOLDS, ...input.thresholds };
  const { current } = input;

  // La ventana: los N cerrados más recientes. Que vengan del más nuevo al más
  // viejo es parte del contrato — cortar por el otro lado promediaría los períodos
  // más viejos, que es exactamente lo contrario de una media MÓVIL.
  const history = input.history.slice(0, Math.max(0, thresholds.lookbackPeriods));

  const findings: AnomalyFinding[] = [];
  const skipped: { signal: AnomalySignal; reason: string }[] = [];

  const hasHistory = history.length >= thresholds.minPeriods;
  const insufficient =
    `Todavía no hay suficiente historia para detectar desvíos: van ${history.length} de ` +
    `${thresholds.minPeriods} períodos cerrados necesarios.`;

  if (hasHistory) {
    findings.push(...detectMixDeviation(current, history, thresholds, skipped));
    findings.push(...detectUnitCostJump(current, history, thresholds, skipped));
  } else {
    skipped.push({ signal: 'MIX_DEVIATION', reason: insufficient });
    skipped.push({ signal: 'UNIT_COST_JUMP', reason: insufficient });
  }

  // S3 va SIEMPRE: no compara contra el pasado sino contra el presupuesto que el
  // costista ya cargó. Es la única señal que sirve en el primer período de una
  // estructura nueva, que es cuando el costista más mira el producto.
  findings.push(...detectCifVariance(current, thresholds, skipped));

  // Primero lo grave, y dentro de cada nivel lo que más se movió.
  const rank = { critical: 0, warn: 1, info: 2 } as const;
  findings.sort(
    (a, b) => rank[a.severity] - rank[b.severity] || Math.abs(b.deviation) - Math.abs(a.deviation),
  );

  return {
    findings,
    skipped,
    periodsAvailable: history.length,
    periodsRequired: thresholds.minPeriods,
  };
}

/**
 * S1 — DESVÍO DE MEZCLA.
 *
 * La participación de cada elemento sobre el costo de producción, contra su media
 * móvil. En puntos, no en %: "la MP pasó de representar el 40% al 58% del costo"
 * es una frase que el costista le repite a su cliente. Un porcentaje de un
 * porcentaje no se lo repite nadie.
 *
 * Los períodos con costo cero no entran en la media: una participación sobre cero
 * no existe, y meterla como 0% arrastraría la media hacia abajo inventando un
 * desvío.
 */
function detectMixDeviation(
  current: AnomalyPeriod,
  history: AnomalyPeriod[],
  thresholds: AnomalyThresholds,
  skipped: { signal: AnomalySignal; reason: string }[],
): AnomalyFinding[] {
  const currentTotal = new Decimal(current.result.productionCost);
  if (currentTotal.lessThanOrEqualTo(0)) {
    skipped.push({
      signal: 'MIX_DEVIATION',
      reason: 'El período no tiene costo de producción: no hay participaciones que comparar.',
    });
    return [];
  }

  const usable = history.filter((h) => new Decimal(h.result.productionCost).greaterThan(0));
  if (usable.length < thresholds.minPeriods) {
    skipped.push({
      signal: 'MIX_DEVIATION',
      reason:
        `Solo ${usable.length} de los períodos anteriores tienen costo de producción cargado: ` +
        `hacen falta ${thresholds.minPeriods} para calcular el promedio.`,
    });
    return [];
  }

  const findings: AnomalyFinding[] = [];

  for (const element of ELEMENTS) {
    const actual = new Decimal(element.of(current.result)).dividedBy(currentTotal).times(100);
    const baseline = mean(
      usable.map((h) =>
        new Decimal(element.of(h.result)).dividedBy(new Decimal(h.result.productionCost)).times(100),
      ),
    )!;

    const deviation = actual.minus(baseline);
    if (deviation.abs().lessThan(thresholds.mixDeviationPoints)) continue;

    const subio = deviation.isPositive();
    findings.push({
      signal: 'MIX_DEVIATION',
      conceptKey: element.key,
      conceptLabel: element.label,
      severity: severityOf(deviation, thresholds.mixDeviationPoints),
      actual: round(actual),
      baseline: round(baseline),
      deviation: round(deviation),
      periodsUsed: usable.length,
      message:
        `En ${current.label}, ${element.label.toLowerCase()} pasó a representar el ${pct(actual)} del costo ` +
        `de producción, cuando venía siendo el ${pct(baseline)}: ${subio ? 'subió' : 'bajó'} ` +
        `${fmt(deviation.abs(), 1)} puntos.`,
      explanation: [
        `Participación en ${current.label}: ${pct(actual)} (${money(element.of(current.result))} sobre ${money(currentTotal)}).`,
        `Promedio de los últimos ${usable.length} períodos cerrados: ${pct(baseline)}.`,
        'La participación no depende de cuánto se produjo: un período más grande mueve todos los importes, no la mezcla.',
      ],
    });
  }

  return findings;
}

/**
 * S2 — SALTO DE COSTO UNITARIO.
 *
 * Dos niveles:
 *   · el costo por unidad, total y por elemento;
 *   · el PRECIO IMPLÍCITO de cada materia prima (consumo valorizado ÷ cantidad
 *     consumida), que es el que separa la inflación del desperdicio.
 *
 * Sin cantidad producida no se evalúa nada de esto. Caer a las unidades vendidas
 * —como hace la comparación de períodos, avisando— acá no sirve: un desvío
 * detectado sobre una base distinta a la de la media móvil sería un artefacto del
 * método, no un hecho de la planta.
 */
function detectUnitCostJump(
  current: AnomalyPeriod,
  history: AnomalyPeriod[],
  thresholds: AnomalyThresholds,
  skipped: { signal: AnomalySignal; reason: string }[],
): AnomalyFinding[] {
  const findings: AnomalyFinding[] = [];

  const withUnits = history.filter((h) => h.units !== null && h.units > 0);

  if (current.units === null || current.units <= 0) {
    skipped.push({
      signal: 'UNIT_COST_JUMP',
      reason:
        'Falta la cantidad producida del período: sin ella no se puede calcular el costo por unidad. ' +
        'Cargala en la sección de Venta y el desvío se detecta solo.',
    });
  } else if (withUnits.length < thresholds.minPeriods) {
    skipped.push({
      signal: 'UNIT_COST_JUMP',
      reason:
        `Solo ${withUnits.length} de los períodos anteriores tienen cargada la cantidad producida: ` +
        `hacen falta ${thresholds.minPeriods} para calcular el promedio del costo por unidad.`,
    });
  } else {
    const units = new Decimal(current.units);

    const perUnit = [
      { key: 'productionCost', label: 'El costo de producción', of: (r: FrozenCalculation) => r.productionCost },
      ...ELEMENTS.map((e) => ({ key: e.key, label: e.label, of: e.of })),
    ];

    for (const concept of perUnit) {
      const actual = new Decimal(concept.of(current.result)).dividedBy(units);
      const baseline = mean(
        withUnits.map((h) => new Decimal(concept.of(h.result)).dividedBy(new Decimal(h.units!))),
      )!;

      // Sin base no hay "subió un %": no se puede medir un salto desde la nada.
      if (baseline.isZero()) continue;

      const deviationPct = actual.minus(baseline).dividedBy(baseline.abs()).times(100);
      if (deviationPct.abs().lessThan(thresholds.unitCostJumpPct)) continue;

      findings.push({
        signal: 'UNIT_COST_JUMP',
        conceptKey: concept.key,
        conceptLabel: concept.label,
        severity: severityOf(deviationPct, thresholds.unitCostJumpPct),
        actual: round(actual),
        baseline: round(baseline),
        deviation: round(deviationPct),
        periodsUsed: withUnits.length,
        message:
          `${concept.label} por unidad ${deviationPct.isPositive() ? 'subió' : 'bajó'} ${pct(deviationPct.abs())} ` +
          `en ${current.label}: pasó de ${price(baseline)} a ${price(actual)}.`,
        explanation: [
          `${current.label}: ${money(concept.of(current.result))} ÷ ${fmt(units, 2)} unidades = ${price(actual)} por unidad.`,
          `Promedio de los últimos ${withUnits.length} períodos cerrados: ${price(baseline)} por unidad.`,
        ],
      });
    }
  }

  findings.push(...detectMaterialPriceJump(current, history, thresholds, skipped));
  return findings;
}

/**
 * El precio implícito de cada materia prima: consumo valorizado ÷ cantidad
 * consumida. Es el PPP con el que el motor valuó las salidas del período.
 *
 * Esto es lo que en Argentina lo es todo: "la chapa subió $500.000" no le dice
 * nada al costista; "el kilo de chapa pasó de $1.200 a $1.850" le dice si el
 * problema es la planta o el país.
 *
 * Se empareja con `materialKey()` —el mismo criterio que la comparación entre
 * períodos— y no por posición en la lista: si el costista reordena las materias
 * primas entre períodos, comparar por posición compararía la chapa contra el
 * aluminio.
 */
function detectMaterialPriceJump(
  current: AnomalyPeriod,
  history: AnomalyPeriod[],
  thresholds: AnomalyThresholds,
  skipped: { signal: AnomalySignal; reason: string }[],
): AnomalyFinding[] {
  if (current.rawMaterialConfig === undefined) {
    skipped.push({
      signal: 'UNIT_COST_JUMP',
      reason:
        'No está la ficha de materia prima del período: sin las cantidades consumidas no se puede ' +
        'saber si una materia prima cambió de precio o solo se consumió más.',
    });
    return [];
  }

  const pricesOf = (period: AnomalyPeriod): Map<string, { price: Decimal; label: string; unit: string | null }> => {
    const out = new Map<string, { price: Decimal; label: string; unit: string | null }>();
    if (period.rawMaterialConfig === undefined) return out;
    const quantities = consumedQuantitiesOf(period.rawMaterialConfig);

    period.result.detail.rawMaterial.materials.forEach((m, i) => {
      const key = materialKey(m, i);
      const qty = quantities.get(key) ?? ZERO;
      // Sin consumo no hay precio que mostrar: dividir por cero no es "gratis", es nada.
      if (qty.lessThanOrEqualTo(0)) return;
      out.set(key, {
        price: new Decimal(m.consumed).dividedBy(qty),
        label: m.name ?? m.code ?? `Materia prima ${i + 1}`,
        unit: m.unit ?? null,
      });
    });
    return out;
  };

  const currentPrices = pricesOf(current);
  const historical = history.map(pricesOf);
  const findings: AnomalyFinding[] = [];

  for (const [key, now] of currentPrices) {
    // La media se arma SOLO con los períodos en los que esa MP se consumió. Una
    // materia prima que se usa un mes sí y otro no tiene menos observaciones que
    // el período, y contar los meses sin consumo como precio cero la haría saltar
    // siempre.
    const observations = historical
      .map((p) => p.get(key)?.price)
      .filter((p): p is Decimal => p !== undefined);

    if (observations.length < thresholds.minPeriods) continue;

    const baseline = mean(observations)!;
    if (baseline.isZero()) continue;

    const deviationPct = now.price.minus(baseline).dividedBy(baseline.abs()).times(100);
    if (deviationPct.abs().lessThan(thresholds.unitCostJumpPct)) continue;

    const porUnidad = now.unit ? `el ${now.unit}` : 'la unidad';
    const masOMenos = deviationPct.isPositive() ? 'más' : 'menos';
    findings.push({
      signal: 'UNIT_COST_JUMP',
      conceptKey: key,
      conceptLabel: now.label,
      severity: severityOf(deviationPct, thresholds.unitCostJumpPct),
      actual: round(now.price, 6),
      baseline: round(baseline, 6),
      deviation: round(deviationPct),
      periodsUsed: observations.length,
      message:
        `${now.label}: ${porUnidad} se consumió a ${price(now.price)} en ${current.label}, ` +
        `un ${pct(deviationPct.abs())} ${masOMenos} que el promedio de ${price(baseline)}.`,
      explanation: [
        `Precio al que se consumió en ${current.label}: ${price(now.price)}.`,
        `Promedio de los ${observations.length} períodos anteriores en los que se consumió: ${price(baseline)}.`,
        'Es el costo al que salió cada unidad consumida, no el de la última compra: si el precio se movió, ' +
          'acá se ve aunque el stock viejo todavía lo amortigüe.',
      ],
    });
  }

  return findings;
}

/**
 * S3 — VARIACIONES DE CIF.
 *
 * El motor ya las calcula (`indirect-costs.ts`) y hoy el número muere en el
 * reporte. Son las de la cátedra:
 *
 *   · sub/sobreaplicación = aplicado − real;
 *   · variación presupuesto = real − presupuesto ajustado al nivel real;
 *   · variación volumen = (capacidad normal − actividad real) × cuota fija,
 *     que desfavorable ES capacidad ociosa.
 *
 * No necesita historia: el patrón de comparación es contra el presupuesto que el
 * costista ya cargó. Por eso es la señal que sirve desde el primer período.
 *
 * Los centros con `pendingClosing` se saltean: sin actividad real ni CIP real las
 * variaciones no se calcularon y valen cero. Alertar sobre esos ceros sería
 * inventar una anomalía a partir de un dato que falta — que es exactamente lo que
 * el producto no hace.
 */
function detectCifVariance(
  current: AnomalyPeriod,
  thresholds: AnomalyThresholds,
  skipped: { signal: AnomalySignal; reason: string }[],
): AnomalyFinding[] {
  const centers = Object.entries(current.result.detail.indirectCosts.perDepartment);
  if (centers.length === 0) return [];

  const names = centerNamesOf(current.indirectCostConfig);
  const findings: AnomalyFinding[] = [];
  let pending = 0;

  for (const [centerId, c] of centers) {
    if (c.pendingClosing) {
      pending++;
      continue;
    }

    const applied = new Decimal(c.appliedCip).abs();
    // Sin CIF aplicado no hay base contra la cual medir un %: un centro que no
    // aplicó nada no tiene una variación "grande", tiene una variación sin escala.
    if (applied.isZero()) continue;

    const label = names.get(centerId) ?? centerId;

    const checks = [
      {
        value: new Decimal(c.overUnderApplied),
        titulo: (favorable: boolean) => (favorable ? 'sobreaplicado' : 'subaplicado'),
        /** (+) sobreaplicado: el costeo cargó de más. (−) subaplicado. */
        explicar: (v: Decimal) =>
          v.isPositive()
            ? 'Se aplicó al producto más CIF del que realmente se gastó.'
            : 'Se aplicó al producto menos CIF del que realmente se gastó: ese costo quedó sin absorber.',
        key: 'overUnder',
        nombre: 'La aplicación de CIF',
      },
      {
        value: new Decimal(c.budgetVariance),
        titulo: (favorable: boolean) => (favorable ? 'favorable' : 'desfavorable'),
        explicar: (v: Decimal) =>
          v.isPositive()
            ? 'Se gastó más CIF del presupuestado para el nivel de actividad real.'
            : 'Se gastó menos CIF del presupuestado para el nivel de actividad real.',
        key: 'budgetVariance',
        nombre: 'La variación presupuesto',
      },
      {
        value: new Decimal(c.volumeVariance),
        titulo: (favorable: boolean) => (favorable ? 'favorable' : 'desfavorable'),
        explicar: (v: Decimal) =>
          v.isPositive()
            ? 'Se produjo menos que la capacidad normal: la diferencia es capacidad ociosa.'
            : 'Se produjo por encima de la capacidad normal.',
        key: 'volumeVariance',
        nombre: 'La variación volumen',
      },
    ];

    for (const check of checks) {
      const relative = check.value.dividedBy(applied).times(100);
      if (relative.abs().lessThan(thresholds.cifVariancePct)) continue;

      // En las tres, (+) es desfavorable para el costista salvo en la
      // sobreaplicación, que es simplemente "cargó de más". El texto lo dice; el
      // signo se conserva tal como lo produce el motor para no reinterpretarlo.
      findings.push({
        signal: 'CIF_VARIANCE',
        conceptKey: `${centerId}:${check.key}`,
        conceptLabel: `${label} — ${check.nombre.replace(/^La |^El /, '')}`,
        severity: severityOf(relative, thresholds.cifVariancePct),
        actual: round(check.value, 2),
        baseline: null,
        deviation: round(relative),
        periodsUsed: 0,
        message:
          `${check.nombre} de ${label} es de ${money(check.value.abs())} en ${current.label}, ` +
          `un ${pct(relative.abs())} del CIF aplicado del centro.`,
        explanation: [
          check.explicar(check.value),
          `CIF aplicado del centro: ${money(c.appliedCip)} · CIF real: ${money(c.actualCip)}.`,
          `Capacidad normal: ${fmt(c.normalCapacity, 2)} · actividad real: ${fmt(c.actualActivity, 2)}.`,
        ],
      });
    }
  }

  if (pending > 0) {
    skipped.push({
      signal: 'CIF_VARIANCE',
      reason:
        `${pending} ${pending === 1 ? 'centro no tiene' : 'centros no tienen'} cargados los datos de cierre ` +
        '(actividad real y CIF real): sus variaciones no se calcularon y no se pueden evaluar.',
    });
  }

  return findings;
}

/** id de centro → nombre, tal como lo tiene la config del período. */
function centerNamesOf(indirectCostConfig: unknown): Map<string, string> {
  const cfg = indirectCostConfig as { centers?: { id?: string; name?: string }[] } | null | undefined;
  const out = new Map<string, string>();
  for (const c of cfg?.centers ?? []) {
    if (c.id && c.name) out.set(c.id, c.name);
  }
  return out;
}
