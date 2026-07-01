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
  /** Horas-hombre trabajadas (HH) en el período. */
  hoursWorked: Decimal.Value;
}

export interface DepartmentLaborResult {
  name: string;
  basicRemuneration: Money;
  /** Costo de cargas sociales = básicas × ITCS. */
  socialChargesCost: Money;
  /** Costo total MOD = básicas + cargas. */
  totalMod: Money;
  hoursWorked: Decimal;
  /** Tarifa horaria integral = costo total MOD / HH. */
  hourlyRate: Money;
}

export function calcDepartmentMod(
  dept: DepartmentLaborConfig,
  itcs: Percentage,
): DepartmentLaborResult {
  const basic = Money.of(dept.basicRemuneration);
  const socialChargesCost = basic.applyRate(itcs.toFraction());
  const totalMod = basic.add(socialChargesCost);
  const hh = new Decimal(dept.hoursWorked);
  const hourlyRate = hh.greaterThan(0) ? totalMod.divide(hh) : Money.zero();

  return {
    name: dept.name,
    basicRemuneration: basic,
    socialChargesCost,
    totalMod,
    hoursWorked: hh,
    hourlyRate,
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

export interface DirectLaborResult {
  workingDays: WorkingDaysResult;
  itcs: ItcsResult;
  departments: DepartmentLaborResult[];
  /** Costo total de MOD (Σ costo total de cada departamento). */
  totalMod: Money;
}

export function calcDirectLabor(config: DirectLaborConfig): DirectLaborResult {
  const workingDays = calcWorkingDays(config.workingDays);
  const itcs = calcITCS(config.itcs, workingDays.iap);
  const departments = config.departments.map((d) => calcDepartmentMod(d, itcs.itcs));
  const totalMod = Money.sum(departments.map((d) => d.totalMod));

  return { workingDays, itcs, departments, totalMod };
}
