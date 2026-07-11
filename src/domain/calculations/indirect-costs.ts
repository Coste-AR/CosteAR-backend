import { Decimal } from 'decimal.js';
import { Money } from '../value-objects/money.js';
import { CalcError } from '../errors/domain-error.js';

/**
 * HOJA 3 · COSTOS INDIRECTOS DE PRODUCCIÓN (CIP)
 *
 * Flujo metodológico (cátedra UNT):
 *   1. Prorrateo PRIMARIO: se reparten los CIF presupuestados a TODOS los
 *      centros de costo (productivos y de servicio) según bases de distribución.
 *   2. Prorrateo SECUNDARIO: los centros de SERVICIO transfieren su costo a los
 *      centros PRODUCTIVOS; el saldo de los servicios queda en cero.
 *   3. CUOTAS predeterminadas: por cada depto productivo se calcula una cuota
 *      fija (Cpf) y una variable (Cpv) sobre la capacidad normal (bp).
 *   4. VARIACIONES: se compara el CIP aplicado contra el real y se descompone
 *      el desvío en variación presupuesto y variación volumen.
 *
 * Todo separa SIEMPRE componente fijo y variable, porque las cuotas y las
 * variaciones se calculan distinto para cada uno.
 */

/** Par fijo/variable de un costo. Patrón usado en toda la hoja. */
export interface FixedVariable {
  fixed: Money;
  variable: Money;
}

function fvZero(): FixedVariable {
  return { fixed: Money.zero(), variable: Money.zero() };
}

function fvAdd(a: FixedVariable, b: FixedVariable): FixedVariable {
  return { fixed: a.fixed.add(b.fixed), variable: a.variable.add(b.variable) };
}

// ---------------------------------------------------------------------------
// 1. Prorrateo primario
// ---------------------------------------------------------------------------

export type CostCenterType = 'productive' | 'service';

export interface CostCenter {
  id: string;
  name: string;
  type: CostCenterType;
}

/** Un concepto de CIF a repartir (alquiler, energía, etc.) con su base. */
export interface IndirectCostConcept {
  name: string;
  amount: FixedVariable;
  /**
   * Proporción de la base asignada a cada centro (centerId → unidades de base).
   * Ej. m² para alquiler, kWh para energía. Se reparte proporcionalmente.
   */
  distribution: Record<string, Decimal.Value>;
}

/** Resultado del prorrateo primario: CIF acumulado por centro. */
export type PrimaryProrationResult = Record<string, FixedVariable>;

/**
 * Reparte cada concepto entre los centros según su base de distribución.
 * La suma repartida de cada concepto iguala su monto original (sin pérdida).
 */
export function primaryProration(
  centers: CostCenter[],
  concepts: IndirectCostConcept[],
): PrimaryProrationResult {
  const result: PrimaryProrationResult = {};
  for (const c of centers) result[c.id] = fvZero();

  for (const concept of concepts) {
    const totalBase = Object.values(concept.distribution).reduce(
      (acc: Decimal, v) => acc.plus(v),
      new Decimal(0),
    );
    if (totalBase.isZero()) {
      throw new CalcError(`Concepto "${concept.name}": base de distribución total = 0`);
    }

    for (const [centerId, baseUnits] of Object.entries(concept.distribution)) {
      const share = new Decimal(baseUnits).dividedBy(totalBase);
      const current = result[centerId];
      if (!current) {
        throw new CalcError(
          `Concepto "${concept.name}" referencia un centro inexistente: ${centerId}`,
        );
      }
      result[centerId] = fvAdd(current, {
        fixed: concept.amount.fixed.applyRate(share),
        variable: concept.amount.variable.applyRate(share),
      });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// 2. Prorrateo secundario
// ---------------------------------------------------------------------------

export interface ServiceDistribution {
  /** Id del centro de servicio que distribuye. */
  serviceCenterId: string;
  /** Reparto hacia centros productivos (productiveId → unidades de base). */
  toProductive: Record<string, Decimal.Value>;
  toProductiveFixed?: Record<string, Decimal.Value>;
  toProductiveVariable?: Record<string, Decimal.Value>;
}

/**
 * Transfiere el costo de los centros de servicio a los productivos.
 *
 * Implementación de pasada directa (no recíproco): cada servicio reparte su
 * costo primario únicamente a centros productivos. Devuelve el CIP acumulado
 * (primario + secundario) por centro PRODUCTIVO.
 */
export function secondaryProration(
  centers: CostCenter[],
  primary: PrimaryProrationResult,
  serviceDistributions: ServiceDistribution[],
): Record<string, FixedVariable> {
  const productiveIds = centers.filter((c) => c.type === 'productive').map((c) => c.id);
  const result: Record<string, FixedVariable> = {};
  for (const id of productiveIds) {
    result[id] = primary[id] ?? fvZero();
  }

  for (const dist of serviceDistributions) {
    const serviceCost = primary[dist.serviceCenterId];
    if (!serviceCost) {
      throw new CalcError(`Servicio inexistente en prorrateo: ${dist.serviceCenterId}`);
    }

    // Distribuir costo Fijo
    const fixedDist = dist.toProductiveFixed && Object.keys(dist.toProductiveFixed).length > 0
      ? dist.toProductiveFixed
      : dist.toProductive;
    const totalBaseFixed = Object.values(fixedDist).reduce(
      (acc: Decimal, v) => acc.plus(v),
      new Decimal(0),
    );

    // Distribuir costo Variable
    const variableDist = dist.toProductiveVariable && Object.keys(dist.toProductiveVariable).length > 0
      ? dist.toProductiveVariable
      : dist.toProductive;
    const totalBaseVariable = Object.values(variableDist).reduce(
      (acc: Decimal, v) => acc.plus(v),
      new Decimal(0),
    );

    // Repartir fijo
    if (!totalBaseFixed.isZero() && !serviceCost.fixed.isZero()) {
      for (const [productiveId, baseUnits] of Object.entries(fixedDist)) {
        const share = new Decimal(baseUnits).dividedBy(totalBaseFixed);
        if (result[productiveId]) {
          result[productiveId]!.fixed = result[productiveId]!.fixed.add(serviceCost.fixed.applyRate(share));
        }
      }
    }

    // Repartir variable
    if (!totalBaseVariable.isZero() && !serviceCost.variable.isZero()) {
      for (const [productiveId, baseUnits] of Object.entries(variableDist)) {
        const share = new Decimal(baseUnits).dividedBy(totalBaseVariable);
        if (result[productiveId]) {
          result[productiveId]!.variable = result[productiveId]!.variable.add(serviceCost.variable.applyRate(share));
        }
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// 3. Cuotas predeterminadas
// ---------------------------------------------------------------------------

export interface PredeterminedQuota {
  /** Cpf — cuota fija por unidad de base (capacidad normal). */
  fixedQuota: Money;
  /** Cpv — cuota variable por unidad de base. */
  variableQuota: Money;
  /** Cpt — cuota total = Cpf + Cpv. */
  totalQuota: Money;
}

/**
 * Cuota predeterminada de un depto productivo.
 * @param cipBudget CIP presupuestado (fijo/variable) del depto.
 * @param normalCapacity bp — nivel de actividad normal (ej. horas-máquina).
 */
export function calcPredeterminedQuota(
  cipBudget: FixedVariable,
  normalCapacity: Decimal.Value,
): PredeterminedQuota {
  const bp = new Decimal(normalCapacity);
  if (bp.isZero()) {
    return {
      fixedQuota: Money.zero(),
      variableQuota: Money.zero(),
      totalQuota: Money.zero(),
    };
  }
  const fixedQuota = cipBudget.fixed.divide(bp);
  const variableQuota = cipBudget.variable.divide(bp);
  return {
    fixedQuota,
    variableQuota,
    totalQuota: fixedQuota.add(variableQuota),
  };
}

// ---------------------------------------------------------------------------
// 4. Aplicación y análisis de variaciones
// ---------------------------------------------------------------------------

export interface VarianceAnalysis {
  /** CIP aplicado = cuota total × actividad real. */
  cipApplied: Money;
  /**
   * Sobre/sub-aplicación = aplicado − real.
   * (+) sobreaplicado (el costeo cargó de más), (−) subaplicado.
   */
  overUnderApplied: Money;
  /**
   * Variación presupuesto = CIP real − presupuesto ajustado al nivel real.
   * (+) desfavorable: se gastó más de lo presupuestado. Mide eficiencia en el gasto.
   */
  budgetVariance: Money;
  /**
   * Variación volumen = (capacidad normal − actividad real) × cuota fija.
   * (+) desfavorable: capacidad ociosa (se produjo menos que lo normal).
   */
  volumeVariance: Money;
}

/**
 * Análisis de variaciones de dos vías (presupuesto y volumen).
 *
 * Convención de signo (igual que el Excel de la cátedra):
 *   variación (+) = desfavorable.
 *   Regla de control:  Var.Presupuesto + Var.Volumen = −(Sobre/Sub-aplicación).
 *
 * @param quota Cuota predeterminada del depto.
 * @param cipBudget CIP presupuestado (fijo/variable) a capacidad normal.
 * @param normalCapacity bp — capacidad normal.
 * @param actualActivity Actividad real del período.
 * @param actualCip CIP real incurrido en el período.
 */
export function calcVarianceAnalysis(
  quota: PredeterminedQuota,
  cipBudget: FixedVariable,
  normalCapacity: Decimal.Value,
  actualActivity: Decimal.Value,
  actualCip: Money,
): VarianceAnalysis {
  const bp = new Decimal(normalCapacity);
  const real = new Decimal(actualActivity);

  // CIP aplicado = cuota total × actividad real.
  const cipApplied = quota.totalQuota.multiply(real);

  // Presupuesto ajustado al nivel real: el fijo NO cambia, el variable sí.
  const variablePerUnit = cipBudget.variable.divide(bp);
  const budgetAtActual = cipBudget.fixed.add(variablePerUnit.multiply(real));

  // Variación presupuesto = real − presupuesto ajustado. (+) = desfavorable.
  const budgetVariance = actualCip.subtract(budgetAtActual);

  // Variación volumen = (capacidad normal − actividad real) × cuota fija.
  // (+) = desfavorable (ociosidad).
  const volumeVariance = quota.fixedQuota.multiply(bp.minus(real));

  // Sobre/sub-aplicación = aplicado − real.
  const overUnderApplied = cipApplied.subtract(actualCip);

  return { cipApplied, overUnderApplied, budgetVariance, volumeVariance };
}

export { fvZero, fvAdd };
