import { Decimal } from 'decimal.js';
import { Money } from '../value-objects/money.js';
import { Percentage } from '../value-objects/percentage.js';

/**
 * HOJA 2 · MANO DE OBRA DIRECTA (MOD)
 *
 * Replica celda por celda la metodología de la Cátedra de Costos (UNT):
 *   A) Distribución de los días del año (ausentismo pago y no pago).
 *   B) IAP — Inasistencias Pagas Inciertas = Ausentismo pago / días efectivos.
 *   C) ITCS — Índice Total de Cargas Sociales, en tres bloques:
 *        1. Cargas Sociales Ciertas (CSC): contribuciones, ART fija, SAC y
 *           las cargas ciertas sobre el SAC.
 *        2. Cargas Inciertas REMUNERATIVAS (IAP, premios, antigüedad), que
 *           además generan cargas DERIVADAS sobre la base y sobre el SAC.
 *        3. Cargas Inciertas NO REMUNERATIVAS (ropa, viandas, medicamentos).
 *   D) Costo total de MOD y tarifa horaria integral por departamento.
 *
 * Verificado contra el ejemplo del Excel: ITCS ≈ 79,99 %.
 */

// ---------------------------------------------------------------------------
// A) Distribución de días del año
// ---------------------------------------------------------------------------

export interface WorkingDaysConfig {
  totalDaysPerYear: Decimal.Value;
  /** Ausentismo NO pago (deducciones). */
  unpaidAbsence: {
    sundays: Decimal.Value;
    saturdays: Decimal.Value;
    unjustifiedAbsences: Decimal.Value;
    /** Feriados coincidentes con fin de semana: se RESTAN del no pago. */
    holidaysOnWeekend: Decimal.Value;
  };
  /** Ausentismo pago (licencias legales). */
  paidAbsence: {
    holidays: Decimal.Value;
    vacations: Decimal.Value;
    sickness: Decimal.Value;
    specialLeaves: Decimal.Value;
    workAccidents: Decimal.Value;
  };
}

export interface WorkingDaysResult {
  totalUnpaidAbsence: Decimal;
  daysToPayFor: Decimal;
  totalPaidAbsence: Decimal;
  effectiveWorkDays: Decimal;
  /** IAP — Inasistencias Pagas Inciertas (fracción). */
  iap: Percentage;
}

export function calcWorkingDays(c: WorkingDaysConfig): WorkingDaysResult {
  const total = new Decimal(c.totalDaysPerYear);
  const u = c.unpaidAbsence;
  const p = c.paidAbsence;

  // Total ausentismo no pago = domingos + sábados + inasistencias − feriados coincidentes.
  const totalUnpaidAbsence = new Decimal(u.sundays)
    .plus(u.saturdays)
    .plus(u.unjustifiedAbsences)
    .minus(u.holidaysOnWeekend);

  const daysToPayFor = total.minus(totalUnpaidAbsence);

  const totalPaidAbsence = new Decimal(p.holidays)
    .plus(p.vacations)
    .plus(p.sickness)
    .plus(p.specialLeaves)
    .plus(p.workAccidents);

  const effectiveWorkDays = daysToPayFor.minus(totalPaidAbsence);

  const iap = effectiveWorkDays.greaterThan(0)
    ? Percentage.fromFraction(totalPaidAbsence.dividedBy(effectiveWorkDays))
    : Percentage.zero();

  return { totalUnpaidAbsence, daysToPayFor, totalPaidAbsence, effectiveWorkDays, iap };
}

// ---------------------------------------------------------------------------
// C) ITCS — Índice Total de Cargas Sociales
// ---------------------------------------------------------------------------

export interface NamedCoefficient {
  name: string;
  /** Coeficiente como fracción (0.27 = 27%). */
  coefficient: Decimal.Value;
}

export interface ItcsConfig {
  /** Base de derivación: contribuciones patronales + ART variable (0.27). */
  derivationBase: Decimal.Value;
  /** ART fija (0.015). */
  fixedArt: Decimal.Value;
  /** Fracción del SAC (aguinaldo). Por defecto 1/12. */
  sacFraction?: Decimal.Value;
  /** Cargas inciertas remunerativas SIN el IAP (premios, antigüedad). */
  uncertainRemunerative: NamedCoefficient[];
  /** Cargas inciertas no remunerativas (ropa, viandas, medicamentos). */
  uncertainNonRemunerative: NamedCoefficient[];
}

export interface ItcsResult {
  /** Subtotal Cargas Sociales Ciertas (CSC). */
  certainCharges: Percentage;
  /** Σ coeficientes de inciertas remunerativas (incluye IAP). */
  uncertainRemunerativeCoefs: Percentage;
  /** Σ cargas derivadas de las inciertas remunerativas. */
  derivedCharges: Percentage;
  /** Σ inciertas no remunerativas. */
  uncertainNonRemunerative: Percentage;
  /** Índice Total de Cargas Sociales. */
  itcs: Percentage;
}

/**
 * Calcula el ITCS. El IAP (que sale del cálculo de días) se inyecta como una
 * carga incierta remunerativa más.
 *
 * Para cada incierta remunerativa con coeficiente `k`, la carga derivada es:
 *   k · (base_derivación + SAC + base_derivación · SAC)
 * (cargas sobre la remuneración, sobre el SAC, y cargas ciertas del SAC).
 */
export function calcITCS(config: ItcsConfig, iap: Percentage): ItcsResult {
  const base = new Decimal(config.derivationBase);
  const art = new Decimal(config.fixedArt);
  const sac = new Decimal(config.sacFraction ?? new Decimal(1).dividedBy(12));

  // 1) Cargas Sociales Ciertas.
  const chargesOnSac = base.times(sac);
  const certain = base.plus(art).plus(sac).plus(chargesOnSac);

  // 2) Inciertas remunerativas: IAP + las configuradas (filtrando duplicados de IAP).
  const remunerative: NamedCoefficient[] = [
    { name: 'IAP', coefficient: iap.toFraction() },
    ...config.uncertainRemunerative.filter(
      (item) => !item.name.toLowerCase().startsWith('iap')
    ),
  ];
  // Factor de derivación por unidad de coeficiente.
  const derivationFactor = base.plus(sac).plus(base.times(sac));

  let sumCoefs = new Decimal(0);
  let sumDerived = new Decimal(0);
  for (const item of remunerative) {
    const k = new Decimal(item.coefficient);
    sumCoefs = sumCoefs.plus(k);
    sumDerived = sumDerived.plus(k.times(derivationFactor));
  }

  // 3) Inciertas no remunerativas.
  const nonRem = config.uncertainNonRemunerative.reduce(
    (acc: Decimal, c) => acc.plus(c.coefficient),
    new Decimal(0),
  );

  const itcs = certain.plus(sumCoefs).plus(nonRem).plus(sumDerived);

  return {
    certainCharges: Percentage.fromFraction(certain),
    uncertainRemunerativeCoefs: Percentage.fromFraction(sumCoefs),
    derivedCharges: Percentage.fromFraction(sumDerived),
    uncertainNonRemunerative: Percentage.fromFraction(nonRem),
    itcs: Percentage.fromFraction(itcs),
  };
}

// ---------------------------------------------------------------------------
// D) Costo total de MOD y tarifa horaria integral por departamento
// ---------------------------------------------------------------------------

export interface DepartmentLaborConfig {
  name: string;
  /** Remuneraciones básicas anuales del departamento ($). */
  basicRemuneration: Decimal.Value;
  /**
   * HORAS PAGADAS — «presencia en fábrica» (Clase 10). Las horas por las que la
   * empresa paga: el operario está en planta, trabaje o no. Es la base sobre la
   * que se reparte el costo total de MOD.
   *
   * Se sigue llamando `hoursWorked` por historia: es el ÚNICO campo de horas que
   * tienen las estructuras ya cargadas, y renombrarlo obligaría a migrar el
   * JSONB de todas ellas. Su significado y su valor no cambian.
   */
  hoursWorked: Decimal.Value;
  /**
   * HORAS NETAS PRODUCTIVAS (Clase 10) = presencia en fábrica − tiempos perdidos
   * informados. Son las únicas horas imputables a las órdenes.
   *
   * OPCIONAL Y RETROCOMPATIBLE: si no viene, se asume que toda la presencia fue
   * productiva (no hay capacidad ociosa) y el cálculo queda IDÉNTICO al
   * histórico — mismo costo, misma tarifa, mismo total.
   *
   * OJO: esto NO es el ausentismo pago del IAP/ITCS. El IAP cubre las AUSENCIAS
   * PAGAS (vacaciones, enfermedad, feriados): el operario no está en planta. Acá
   * el operario ESTÁ en planta y cobra, pero no hay trabajo que asignarle. Los
   * dos conviven y se suman: el IAP infla el índice de cargas sociales, la
   * capacidad ociosa separa horas dentro de la presencia ya pagada.
   */
  productiveHours?: Decimal.Value;
  /**
   * TIEMPO ESTÁNDAR DE PRODUCCIÓN (Clase 10) — las horas que, según la oficina
   * técnica, DEBERÍA haber llevado producir lo que efectivamente se produjo
   * (horas estándar por unidad × unidades terminadas).
   *
   * Es el dato que habilita el segundo tipo de improductividad de la cátedra:
   *   horas netas productivas − tiempo estándar = IMPRODUCTIVIDAD OCULTA.
   *
   * OPCIONAL Y RETROCOMPATIBLE: sin este dato la improductividad oculta es cero
   * y el cálculo queda idéntico. Si el estándar es MAYOR que las horas netas
   * productivas se trabajó por encima del estándar: no hay improductividad
   * oculta (se recorta a cero), no se inventa una ganancia.
   */
  standardHours?: Decimal.Value;
  /**
   * Detalle POR MOTIVO de los tiempos perdidos informados (Clase 10: corte de
   * energía, rotura de máquina, falta de materia prima, mantenimiento
   * programado, descanso/refrigerio, gestiones personales…).
   *
   * Es DESCRIPTIVO, no normativo: la fuente de verdad de cuántas horas se
   * perdieron sigue siendo `hoursWorked − productiveHours`. Si los motivos
   * declarados no llegan a cubrir esa diferencia, el motor agrega por su cuenta
   * un renglón «Sin discriminar» con el resto; si se pasan, se recortan. Así el
   * desglose siempre cierra contra el total y nunca lo contradice.
   */
  informedLostTime?: NamedHours[];
}

/** Un motivo de tiempo perdido informado, con sus horas. */
export interface NamedHours {
  /** Motivo, en los términos de la cátedra. Texto libre del costista. */
  reason: string;
  hours: Decimal.Value;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * TIPOS DE IMPRODUCTIVIDAD — terminología de la cátedra (Clase 10)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * La Clase 10 parte de que «las horas de presencia pueden ser productivas o
 * improductivas» y clasifica las improductivas en DOS tipos, y solo dos:
 *
 *   · INFORMADA («tiempos perdidos informados»): la empresa conoce la causa con
 *     anterioridad o la registra formalmente en la planilla de producción
 *     —corte de luz, rotura de máquina, paro de transporte, falta de material,
 *     corte de rutas, mantenimiento programado, media hora de comida—.
 *
 *   · OCULTA («improductividad oculta»): no se informa; surge del análisis del
 *     contador de costos comparando el tiempo real con el tiempo estándar.
 *
 * Y la cadena de cálculo de la clase es exactamente:
 *
 *     Presencia en fábrica
 *   − Tiempos perdidos informados
 *   = Horas netas productivas
 *   − Tiempo estándar de producción
 *   = Improductividad oculta
 *
 * NO hay un tercer tipo. Las «capacidades ociosas anticipada / operativa» de la
 * misma clase son otra cosa: se miden entre niveles de capacidad (normal,
 * operativa, real) y se valorizan con la CUOTA PRESUPUESTADA FIJA, o sea que
 * pertenecen a la hoja de costos indirectos, no a la de mano de obra. Acá la
 * unidad son horas hombre de presencia, así que el desglose que corresponde es
 * informada / oculta.
 */
export type TipoImproductividad = 'tiempos-perdidos-informados' | 'improductividad-oculta';

/** Un tipo de improductividad, valorizado. */
export interface IdleCapacityBucket {
  tipo: TipoImproductividad;
  /** Etiqueta de la cátedra, lista para pantalla. */
  label: string;
  hours: Decimal;
  cost: Money;
  /**
   * Motivos declarados dentro del tipo (solo aplica a los tiempos perdidos
   * informados). Vacío si el costista no discriminó.
   */
  reasons: Array<{ reason: string; hours: Decimal; cost: Money }>;
}

/**
 * CAPACIDAD OCIOSA de un departamento, en horas y en pesos.
 *
 * Regla de la cátedra (Clase 10): el costo de la capacidad ociosa NO es costo
 * del producto — «el cliente no tiene culpa de la ineficiencia interna». Por eso
 * viaja SEPARADO del costo imputable a las órdenes, en su propia línea.
 */
export interface DepartmentIdleCapacityResult {
  /** Horas pagadas — presencia en fábrica. */
  paidHours: Decimal;
  /** Horas netas productivas = presencia − tiempos perdidos informados. */
  productiveHours: Decimal;
  /** Tiempo estándar de producción declarado, o `null` si no se cargó. */
  standardHours: Decimal | null;
  /** Horas imputables a las órdenes = netas productivas − improductividad oculta. */
  chargeableHours: Decimal;
  /** Horas ociosas TOTALES = informadas + ocultas. Nunca negativa. */
  idleHours: Decimal;
  /** Costo de la capacidad ociosa = horas ociosas × costo horario. AISLADO. */
  idleCost: Money;
  /** Costo de MOD imputable a las órdenes = costo total MOD − costo ocioso. */
  applicableMod: Money;
  /** `true` solo si el departamento tiene horas ociosas de algún tipo. */
  hasIdleCapacity: boolean;
  /** El costo ocioso abierto por TIPO de improductividad (cátedra, Clase 10). */
  breakdown: IdleCapacityBucket[];
}

const LABEL_IMPRODUCTIVIDAD: Record<TipoImproductividad, string> = {
  'tiempos-perdidos-informados': 'Tiempos perdidos informados',
  'improductividad-oculta': 'Improductividad oculta',
};

/** Renglón que el motor agrega cuando el costista no discriminó todo el tiempo perdido. */
const MOTIVO_SIN_DISCRIMINAR = 'Sin discriminar';

/**
 * Reparte las horas declaradas por motivo dentro del total de tiempo perdido
 * informado, sin poder contradecirlo: se recorta lo que se pasa y se agrega un
 * renglón «Sin discriminar» con lo que falta.
 */
function splitLostTimeReasons(
  declared: NamedHours[] | undefined,
  totalHours: Decimal,
  costPerHour: Decimal,
): Array<{ reason: string; hours: Decimal; cost: Money }> {
  if (totalHours.lessThanOrEqualTo(0)) return [];

  const rows: Array<{ reason: string; hours: Decimal; cost: Money }> = [];
  let remaining = totalHours;
  for (const item of declared ?? []) {
    if (remaining.lessThanOrEqualTo(0)) break;
    const raw = new Decimal(item.hours);
    if (!raw.isFinite() || raw.lessThanOrEqualTo(0)) continue;
    const hours = Decimal.min(raw, remaining);
    remaining = remaining.minus(hours);
    rows.push({
      reason: item.reason?.trim() || MOTIVO_SIN_DISCRIMINAR,
      hours,
      cost: Money.of(hours.times(costPerHour)),
    });
  }

  // Nada declarado → un único renglón sin discriminar sería ruido: se devuelve
  // vacío y la pantalla muestra solo el total del tipo.
  if (rows.length > 0 && remaining.greaterThan(0)) {
    rows.push({
      reason: MOTIVO_SIN_DISCRIMINAR,
      hours: remaining,
      cost: Money.of(remaining.times(costPerHour)),
    });
  }
  return rows;
}

export interface DepartmentLaborResult {
  name: string;
  basicRemuneration: Money;
  /** Costo de cargas sociales = básicas × ITCS. */
  socialChargesCost: Money;
  /** Costo total MOD = básicas + cargas. SIEMPRE el costo completo del depto. */
  totalMod: Money;
  /** Horas pagadas (presencia en fábrica). Campo histórico, valor sin cambios. */
  hoursWorked: Decimal;
  /**
   * Tarifa horaria integral aplicada a las ÓRDENES.
   *
   *   tarifa = MOD imputable a órdenes ÷ HORAS IMPUTABLES
   *
   * El divisor son SOLO las horas imputables (netas productivas menos la
   * improductividad oculta): las horas ociosas no diluyen la tarifa ni se cuelan
   * en el costo de las órdenes. Sin horas ociosas declaradas el numerador es el
   * MOD total y el divisor la presencia, o sea exactamente la fórmula histórica.
   *
   * Nota: como el costo ocioso se separa EN PROPORCIÓN a las horas, la tarifa da
   * siempre `MOD total ÷ presencia en fábrica`, haya o no ociosidad. Declarar
   * ociosidad no cambia cuánto cuesta la hora; cambia cuántas horas se le
   * cobran al producto.
   */
  hourlyRate: Money;
  /** La capacidad ociosa del departamento, aislada. */
  idleCapacity: DepartmentIdleCapacityResult;
}

export function calcDepartmentMod(
  dept: DepartmentLaborConfig,
  itcs: Percentage,
): DepartmentLaborResult {
  const basic = Money.of(dept.basicRemuneration);
  const socialChargesCost = basic.applyRate(itcs.toFraction());
  const totalMod = basic.add(socialChargesCost);

  // Presencia en fábrica (lo que se paga) y horas netas productivas.
  const paidHours = new Decimal(dept.hoursWorked);
  const declared = dept.productiveHours;
  // Sin dato → toda la presencia fue productiva: retrocompatibilidad exacta.
  // Con dato → nunca puede superar la presencia (no se produce más de lo que se
  // paga); el exceso se recorta en vez de generar horas ociosas negativas.
  const productiveHours =
    declared === undefined || declared === null
      ? paidHours
      : Decimal.min(new Decimal(declared), paidHours);

  // TIPO 1 — tiempos perdidos informados = presencia − horas netas productivas.
  const informedHours = paidHours.minus(productiveHours);

  // TIPO 2 — improductividad oculta = horas netas productivas − tiempo estándar.
  // Sin estándar declarado no se puede deducir: queda en cero (retrocompat). Si
  // el estándar supera a las netas productivas se trabajó por encima del
  // estándar: se recorta a cero, no se inventa una ganancia.
  const declaredStandard = dept.standardHours;
  const standardHours =
    declaredStandard === undefined || declaredStandard === null
      ? null
      : Decimal.max(Decimal.min(new Decimal(declaredStandard), productiveHours), 0);
  const hiddenHours = standardHours === null ? new Decimal(0) : productiveHours.minus(standardHours);

  const idleHours = informedHours.plus(hiddenHours);
  const chargeableHours = paidHours.minus(idleHours);

  // Costo de la capacidad ociosa: la porción del costo total que corresponde a
  // las horas ociosas sobre la presencia pagada. Con `idleHours` = 0 el factor
  // es 0 exacto, `idleCost` es cero exacto y `applicableMod` queda idéntico a
  // `totalMod` — de ahí sale la retrocompatibilidad al centavo.
  const share = (h: Decimal) =>
    paidHours.greaterThan(0) ? totalMod.multiply(h.dividedBy(paidHours)) : Money.zero();
  const idleCost = share(idleHours);
  const informedCost = share(informedHours);
  // La oculta se saca por diferencia para que los dos tipos sumen EXACTAMENTE el
  // costo ocioso, sin residuos de división.
  const hiddenCost = idleCost.subtract(informedCost);
  const applicableMod = totalMod.subtract(idleCost);

  const hourlyRate = chargeableHours.greaterThan(0)
    ? applicableMod.divide(chargeableHours)
    : Money.zero();

  // Costo de la hora de presencia: con él se valorizan los motivos declarados.
  const costPerHour = paidHours.greaterThan(0)
    ? totalMod.toDecimal().dividedBy(paidHours)
    : new Decimal(0);

  const breakdown: IdleCapacityBucket[] = [];
  if (informedHours.greaterThan(0)) {
    breakdown.push({
      tipo: 'tiempos-perdidos-informados',
      label: LABEL_IMPRODUCTIVIDAD['tiempos-perdidos-informados'],
      hours: informedHours,
      cost: informedCost,
      reasons: splitLostTimeReasons(dept.informedLostTime, informedHours, costPerHour),
    });
  }
  if (hiddenHours.greaterThan(0)) {
    breakdown.push({
      tipo: 'improductividad-oculta',
      label: LABEL_IMPRODUCTIVIDAD['improductividad-oculta'],
      hours: hiddenHours,
      cost: hiddenCost,
      reasons: [],
    });
  }

  return {
    name: dept.name,
    basicRemuneration: basic,
    socialChargesCost,
    totalMod,
    hoursWorked: paidHours,
    hourlyRate,
    idleCapacity: {
      paidHours,
      productiveHours,
      standardHours,
      chargeableHours,
      idleHours,
      idleCost,
      applicableMod,
      hasIdleCapacity: idleHours.greaterThan(0),
      breakdown,
    },
  };
}

// ---------------------------------------------------------------------------
// Orquestación completa de la hoja MOD
// ---------------------------------------------------------------------------

export interface DirectLaborConfig {
  workingDays: WorkingDaysConfig;
  itcs: ItcsConfig;
  departments: DepartmentLaborConfig[];
}

/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  DESTINO CONTABLE DEL COSTO DE CAPACIDAD OCIOSA — DECISIÓN TOMADA        ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * La SEPARACIÓN ya estaba hecha: el costo de las horas ociosas se calcula y se
 * expone en su propia línea (`DirectLaborResult.idleCapacity`). Lo que faltaba
 * era el destino de ese importe en el estado de costos. Ya está resuelto:
 *
 *   'perdida-del-periodo'  ← VIGENTE. `totalMod` es el MOD IMPUTABLE a las
 *       órdenes; el costo ocioso sale del costo del producto y va al estado de
 *       resultados como otro egreso (pérdida). Es lo que manda la cátedra
 *       (Clase 10: «Es una pérdida de la empresa, no un costo del producto. El
 *       cliente no tiene culpa de la ineficiencia interna; no se le puede cargar
 *       ese costo. Va directamente al estado de resultados como otro egreso»).
 *
 *   'absorbido-en-el-producto'  → el valor anterior. `totalMod` era el costo
 *       COMPLETO de MOD y el producto absorbía la ociosidad. Nunca fue una
 *       postura contable: era el placeholder elegido para no mover resultados
 *       mientras la decisión estaba abierta. Se conserva en el tipo porque es lo
 *       que documenta qué cambió y permite reproducir el criterio viejo.
 *
 * QUÉ SE MUEVE AL CAMBIARLO
 * -------------------------
 *   · Una estructura SIN horas ociosas declaradas (todas las cargadas hasta hoy,
 *     que solo tienen `hoursWorked`) no se mueve un centavo: `idleCost` es cero
 *     exacto, `applicableMod` === `fullMod`, `totalMod` da lo mismo que antes.
 *   · Una estructura CON ociosidad declarada baja su MOD, su costo de
 *     producción, su costo de ventas y su costo unitario, y sube su margen
 *     bruto; abajo del margen aparece la pérdida por capacidad ociosa. La tarifa
 *     horaria NO se mueve (se reparte en proporción a las horas).
 *
 * Nada más del motor depende de esta constante.
 */
export type DestinoCostoCapacidadOciosa = 'absorbido-en-el-producto' | 'perdida-del-periodo';

export const DESTINO_COSTO_CAPACIDAD_OCIOSA: DestinoCostoCapacidadOciosa =
  'perdida-del-periodo';

/**
 * CARTEL de capacidad ociosa. La cátedra no la trata como un renglón más del
 * estado de resultados: es una PÉRDIDA que hay que ver. Por eso el motor no se
 * limita a devolver el número, devuelve el aviso ya redactado para que la
 * pantalla lo muestre como cartel y no como una línea perdida entre otras.
 *
 * Es `null` cuando no hay ociosidad: sin pérdida no hay nada que avisar.
 */
export interface IdleCapacityAlert {
  /** Severidad de la que depende el color del cartel en pantalla. */
  level: 'advertencia' | 'critico';
  title: string;
  /** Texto ya armado, en términos de la cátedra y sin ids internos. */
  message: string;
  /** Importe de la pérdida. */
  cost: Money;
  /** Peso de las horas ociosas sobre la presencia pagada, en porcentaje. */
  sharePercent: Decimal;
}

/** A partir de acá el cartel pasa de advertencia a crítico. */
const UMBRAL_OCIOSIDAD_CRITICA = 20;

/** Capacidad ociosa consolidada de la hoja MOD (Σ de todos los departamentos). */
export interface DirectLaborIdleCapacityResult {
  /** Σ horas pagadas (presencia en fábrica). */
  paidHours: Decimal;
  /** Σ horas netas productivas. */
  productiveHours: Decimal;
  /** Σ horas imputables a las órdenes (netas productivas − improductividad oculta). */
  chargeableHours: Decimal;
  /** Σ horas ociosas (informadas + ocultas). */
  idleHours: Decimal;
  /** Costo COMPLETO de MOD (remuneraciones + cargas), sin separar nada. */
  fullMod: Money;
  /** Costo de la capacidad ociosa, AISLADO. Nunca se suma en silencio a las órdenes. */
  idleCost: Money;
  /** Costo de MOD imputable a las órdenes = `fullMod` − `idleCost`. */
  applicableMod: Money;
  /** `true` si al menos un departamento declaró horas ociosas. */
  hasIdleCapacity: boolean;
  /** Destino contable vigente del costo ocioso (ver punto de decisión arriba). */
  destination: DestinoCostoCapacidadOciosa;
  /**
   * La pérdida abierta POR TIPO DE IMPRODUCTIVIDAD (cátedra, Clase 10), sumando
   * todos los departamentos. Nunca se muestra la ociosidad como un número solo.
   */
  breakdown: IdleCapacityBucket[];
  /** Cartel para la pantalla. `null` si no hay ociosidad. */
  alert: IdleCapacityAlert | null;
}

/** Consolida los desgloses por tipo de todos los departamentos en uno solo. */
function mergeBreakdown(departments: DepartmentLaborResult[]): IdleCapacityBucket[] {
  const orden: TipoImproductividad[] = ['tiempos-perdidos-informados', 'improductividad-oculta'];
  const out: IdleCapacityBucket[] = [];

  for (const tipo of orden) {
    const buckets = departments
      .map((d) => d.idleCapacity.breakdown.find((b) => b.tipo === tipo))
      .filter((b): b is IdleCapacityBucket => b !== undefined);
    if (buckets.length === 0) continue;

    // Los motivos se suman por nombre, respetando el orden de aparición.
    const porMotivo = new Map<string, { reason: string; hours: Decimal; cost: Money }>();
    for (const b of buckets) {
      for (const r of b.reasons) {
        const prev = porMotivo.get(r.reason);
        porMotivo.set(
          r.reason,
          prev
            ? { reason: r.reason, hours: prev.hours.plus(r.hours), cost: prev.cost.add(r.cost) }
            : { ...r },
        );
      }
    }

    out.push({
      tipo,
      label: LABEL_IMPRODUCTIVIDAD[tipo],
      hours: buckets.reduce((acc, b) => acc.plus(b.hours), new Decimal(0)),
      cost: Money.sum(buckets.map((b) => b.cost)),
      reasons: [...porMotivo.values()],
    });
  }

  return out;
}

/** Arma el cartel a partir de la ociosidad ya consolidada. */
function buildIdleCapacityAlert(
  idle: Omit<DirectLaborIdleCapacityResult, 'alert'>,
): IdleCapacityAlert | null {
  if (!idle.hasIdleCapacity || idle.idleCost.isZero()) return null;

  const sharePercent = idle.paidHours.greaterThan(0)
    ? idle.idleHours.dividedBy(idle.paidHours).times(100)
    : new Decimal(0);

  const importe = idle.idleCost.toNumber().toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const horas = idle.idleHours.toDecimalPlaces(2).toNumber().toLocaleString('es-AR');
  const porcentaje = sharePercent.toDecimalPlaces(2).toNumber().toLocaleString('es-AR');

  const detalle = idle.breakdown
    .map(
      (b) =>
        `${b.label}: ${b.hours.toDecimalPlaces(2).toNumber().toLocaleString('es-AR')} hs ` +
        `($ ${b.cost.toNumber().toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`,
    )
    .join(' · ');

  const enElProducto = idle.destination === 'absorbido-en-el-producto';

  return {
    level: sharePercent.greaterThanOrEqualTo(UMBRAL_OCIOSIDAD_CRITICA) ? 'critico' : 'advertencia',
    title: 'Pérdida por capacidad ociosa',
    message:
      `Se pagaron ${horas} hs que no se le pueden cobrar al producto (${porcentaje} % de la ` +
      `presencia en fábrica), por $ ${importe}. ` +
      (enElProducto
        ? 'Hoy el producto las está absorbiendo.'
        : 'No integran el costo de producción: van al estado de resultados como otro egreso ' +
          '(pérdida del período). El cliente no tiene culpa de la ineficiencia interna.') +
      (detalle ? ` Desglose — ${detalle}.` : ''),
    cost: idle.idleCost,
    sharePercent,
  };
}

export interface DirectLaborResult {
  workingDays: WorkingDaysResult;
  itcs: ItcsResult;
  departments: DepartmentLaborResult[];
  /**
   * Costo de MOD que ENTRA AL ESTADO DE COSTOS. Depende de
   * `DESTINO_COSTO_CAPACIDAD_OCIOSA`: hoy es el MOD IMPUTABLE a las órdenes, o
   * sea el costo completo menos la pérdida por capacidad ociosa. Sin ociosidad
   * declarada coincide exactamente con el costo completo.
   */
  totalMod: Money;
  /** La capacidad ociosa, aislada y siempre disponible, decida lo que se decida. */
  idleCapacity: DirectLaborIdleCapacityResult;
}

export function calcDirectLabor(config: DirectLaborConfig): DirectLaborResult {
  const workingDays = calcWorkingDays(config.workingDays);
  const itcs = calcITCS(config.itcs, workingDays.iap);
  const departments = config.departments.map((d) => calcDepartmentMod(d, itcs.itcs));

  const fullMod = Money.sum(departments.map((d) => d.totalMod));
  const idleCost = Money.sum(departments.map((d) => d.idleCapacity.idleCost));
  const applicableMod = Money.sum(departments.map((d) => d.idleCapacity.applicableMod));
  const sumHours = (pick: (d: DepartmentLaborResult) => Decimal) =>
    departments.reduce((acc, d) => acc.plus(pick(d)), new Decimal(0));

  const sinCartel: Omit<DirectLaborIdleCapacityResult, 'alert'> = {
    paidHours: sumHours((d) => d.idleCapacity.paidHours),
    productiveHours: sumHours((d) => d.idleCapacity.productiveHours),
    chargeableHours: sumHours((d) => d.idleCapacity.chargeableHours),
    idleHours: sumHours((d) => d.idleCapacity.idleHours),
    fullMod,
    idleCost,
    applicableMod,
    hasIdleCapacity: departments.some((d) => d.idleCapacity.hasIdleCapacity),
    destination: DESTINO_COSTO_CAPACIDAD_OCIOSA,
    breakdown: mergeBreakdown(departments),
  };

  const idleCapacity: DirectLaborIdleCapacityResult = {
    ...sinCartel,
    alert: buildIdleCapacityAlert(sinCartel),
  };

  // ↓ El único consumo de la decisión en todo el motor.
  const totalMod =
    DESTINO_COSTO_CAPACIDAD_OCIOSA === 'perdida-del-periodo' ? applicableMod : fullMod;

  return { workingDays, itcs, departments, totalMod, idleCapacity };
}
