import { Decimal } from 'decimal.js';
import { Money } from '../value-objects/money.js';
import { Percentage } from '../value-objects/percentage.js';

/**
 * HOJA 2 · MANO DE OBRA DIRECTA (MOD)
 *
 * Distribución de los días del año, Índice Total de Cargas Sociales (ITCS)
 * y tarifa horaria integral por departamento.
 *
 * El ITCS expresa cuánto se le suma al sueldo nominal por cargas sociales,
 * aguinaldo, vacaciones, ART, etc. La tarifa horaria integral reparte el
 * costo total (sueldo + cargas) entre las horas efectivamente productivas.
 */

export interface WorkingDaysParams {
  /** Días totales del año (365 o 366). */
  totalDaysPerYear: Decimal.Value;
  /** Domingos y feriados no laborables. */
  nonWorkingDays: Decimal.Value;
  /** Días de vacaciones legales. */
  vacationDays: Decimal.Value;
  /** Ausencias promedio estimadas (enfermedad, licencias). */
  averageAbsenceDays: Decimal.Value;
}

/** Días efectivamente trabajados al año tras descontar el no-productivo. */
export function calcWorkingDays(p: WorkingDaysParams): Decimal {
  return new Decimal(p.totalDaysPerYear)
    .minus(p.nonWorkingDays)
    .minus(p.vacationDays)
    .minus(p.averageAbsenceDays);
}

export interface SocialChargeComponent {
  name: string;
  /** Porcentaje sobre el sueldo nominal (notación humana: 17 = 17%). */
  percent: Decimal.Value;
}

/**
 * Índice Total de Cargas Sociales = Σ de los componentes.
 * Ejemplo cátedra: jubilación, obra social, ART, SAC, vacaciones, etc.
 */
export function calcITCS(components: SocialChargeComponent[]): Percentage {
  return Percentage.sum(components.map((c) => Percentage.fromPercent(c.percent)));
}

export interface DepartmentLaborParams {
  departmentName: string;
  /** Cantidad de operarios directos del departamento. */
  workers: number;
  /** Sueldo nominal mensual por operario. */
  monthlyWage: Decimal.Value;
  /** Horas trabajadas por día. */
  hoursPerDay: Decimal.Value;
}

export interface DepartmentLaborResult {
  departmentName: string;
  /** Costo anual nominal (sueldo × 13 meses por aguinaldo, × operarios). */
  annualNominalCost: Money;
  /** Costo anual integral (nominal + cargas sociales). */
  annualIntegralCost: Money;
  /** Horas productivas anuales del departamento. */
  productiveHours: Decimal;
  /** Tarifa horaria integral = costo integral / horas productivas. */
  hourlyRate: Money;
}

/**
 * Tarifa horaria integral por departamento.
 *
 * Costo nominal anual = sueldo mensual × 13 (12 + SAC) × operarios.
 * Costo integral = nominal × (1 + ITCS).
 * Horas productivas = días trabajados × horas/día × operarios.
 * Tarifa = costo integral / horas productivas.
 */
export function calcDepartmentHourlyRate(
  dept: DepartmentLaborParams,
  workingDays: Decimal,
  itcs: Percentage,
): DepartmentLaborResult {
  const workers = new Decimal(dept.workers);
  const monthlyWage = Money.of(dept.monthlyWage);

  // 13 sueldos: 12 meses + 1 aguinaldo (SAC).
  const annualNominalCost = monthlyWage.multiply(13).multiply(workers);
  const annualIntegralCost = annualNominalCost.multiply(itcs.asMultiplier());

  const productiveHours = workingDays
    .times(dept.hoursPerDay)
    .times(workers);

  if (productiveHours.isZero()) {
    throw new Error(
      `Departamento "${dept.departmentName}": horas productivas = 0 (división por cero)`,
    );
  }

  const hourlyRate = annualIntegralCost.divide(productiveHours);

  return {
    departmentName: dept.departmentName,
    annualNominalCost,
    annualIntegralCost,
    productiveHours,
    hourlyRate,
  };
}

export interface DirectLaborResult {
  departments: DepartmentLaborResult[];
  itcs: Percentage;
  workingDays: Decimal;
  /** Costo integral total de MOD (suma de todos los departamentos). */
  totalIntegralCost: Money;
}

/** Calcula la MOD completa de todos los departamentos. */
export function calcDirectLabor(
  workingDaysParams: WorkingDaysParams,
  socialCharges: SocialChargeComponent[],
  departments: DepartmentLaborParams[],
): DirectLaborResult {
  const workingDays = calcWorkingDays(workingDaysParams);
  const itcs = calcITCS(socialCharges);

  const deptResults = departments.map((d) =>
    calcDepartmentHourlyRate(d, workingDays, itcs),
  );

  const totalIntegralCost = Money.sum(
    deptResults.map((d) => d.annualIntegralCost),
  );

  return { departments: deptResults, itcs, workingDays, totalIntegralCost };
}
