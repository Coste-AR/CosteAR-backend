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
  /** Horas netas productivas — las únicas imputables a las órdenes. */
  productiveHours: Decimal;
  /** Horas ociosas = presencia − netas productivas. Nunca negativa. */
  idleHours: Decimal;
  /** Costo de la capacidad ociosa = horas ociosas × tarifa horaria. AISLADO. */
  idleCost: Money;
  /** Costo de MOD imputable a las órdenes = costo total MOD − costo ocioso. */
  applicableMod: Money;
  /** `true` solo si el departamento declaró horas productivas < horas pagadas. */
  hasIdleCapacity: boolean;
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
   *   tarifa = MOD imputable a órdenes ÷ HORAS NETAS PRODUCTIVAS
   *
   * El divisor son SOLO las horas productivas: las horas ociosas no diluyen la
   * tarifa ni se cuelan en el costo de las órdenes. Sin horas ociosas declaradas
   * el numerador es el MOD total y el divisor la presencia, o sea exactamente la
   * fórmula histórica.
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
  const idleHours = paidHours.minus(productiveHours);

  // Costo de la capacidad ociosa: la porción del costo total que corresponde a
  // las horas ociosas sobre la presencia pagada. Con `idleHours` = 0 el factor
  // es 0 exacto, `idleCost` es cero exacto y `applicableMod` queda idéntico a
  // `totalMod` — de ahí sale la retrocompatibilidad al centavo.
  const idleCost = paidHours.greaterThan(0)
    ? totalMod.multiply(idleHours.dividedBy(paidHours))
    : Money.zero();
  const applicableMod = totalMod.subtract(idleCost);

  const hourlyRate = productiveHours.greaterThan(0)
    ? applicableMod.divide(productiveHours)
    : Money.zero();

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
      idleHours,
      idleCost,
      applicableMod,
      hasIdleCapacity: idleHours.greaterThan(0),
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
 * ║  ÚNICO PUNTO DE DECISIÓN — DESTINO CONTABLE DEL COSTO DE CAPACIDAD OCIOSA ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * La SEPARACIÓN ya está hecha y no se discute: el costo de las horas ociosas se
 * calcula y se expone en su propia línea (`DirectLaborResult.idleCapacity`).
 * Lo que todavía NO está decidido —es una decisión de PRODUCTO, no técnica— es
 * a dónde va ese importe en el estado de costos. Las dos opciones:
 *
 *   'absorbido-en-el-producto'  → `totalMod` sigue siendo el costo COMPLETO de
 *       MOD. El estado de costos no cambia en un peso respecto de hoy; el costo
 *       ocioso queda visible como línea informativa pero el producto lo absorbe.
 *       Es el valor VIGENTE, elegido únicamente porque preserva el resultado
 *       actual mientras la decisión no esté tomada. NO es una postura contable.
 *
 *   'perdida-del-periodo'       → `totalMod` pasa a ser el MOD imputable a las
 *       órdenes y el costo ocioso sale del costo del producto para irse al
 *       estado de resultados como otro egreso (pérdida). Es lo que manda la
 *       cátedra (Clase 10: «es una pérdida de la empresa, no un costo del
 *       producto»), y CAMBIA el costo de producción y el margen de toda
 *       estructura que tenga horas ociosas cargadas.
 *
 * Para cambiar el destino se toca UNA línea: la constante de abajo. Nada más
 * del motor depende de esta decisión.
 */
export type DestinoCostoCapacidadOciosa = 'absorbido-en-el-producto' | 'perdida-del-periodo';

export const DESTINO_COSTO_CAPACIDAD_OCIOSA: DestinoCostoCapacidadOciosa =
  'absorbido-en-el-producto';

/** Capacidad ociosa consolidada de la hoja MOD (Σ de todos los departamentos). */
export interface DirectLaborIdleCapacityResult {
  /** Σ horas pagadas (presencia en fábrica). */
  paidHours: Decimal;
  /** Σ horas netas productivas. */
  productiveHours: Decimal;
  /** Σ horas ociosas. */
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
}

export interface DirectLaborResult {
  workingDays: WorkingDaysResult;
  itcs: ItcsResult;
  departments: DepartmentLaborResult[];
  /**
   * Costo de MOD que ENTRA AL ESTADO DE COSTOS. Depende del punto de decisión
   * `DESTINO_COSTO_CAPACIDAD_OCIOSA`: hoy es el costo completo (Σ de cada
   * departamento), igual que antes de que existiera la capacidad ociosa.
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

  const idleCapacity: DirectLaborIdleCapacityResult = {
    paidHours: sumHours((d) => d.idleCapacity.paidHours),
    productiveHours: sumHours((d) => d.idleCapacity.productiveHours),
    idleHours: sumHours((d) => d.idleCapacity.idleHours),
    fullMod,
    idleCost,
    applicableMod,
    hasIdleCapacity: departments.some((d) => d.idleCapacity.hasIdleCapacity),
    destination: DESTINO_COSTO_CAPACIDAD_OCIOSA,
  };

  // ↓ El único consumo de la decisión en todo el motor.
  const totalMod =
    DESTINO_COSTO_CAPACIDAD_OCIOSA === 'perdida-del-periodo' ? applicableMod : fullMod;

  return { workingDays, itcs, departments, totalMod, idleCapacity };
}
