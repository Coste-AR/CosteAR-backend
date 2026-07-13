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
// 2.b Prorrateo secundario ESCALONADO (con orden de cierre)
// ---------------------------------------------------------------------------

/**
 * Un cierre de un centro de servicio dentro del método escalonado (criterio
 * A.3.c). El servicio reparte TODO su costo acumulado (primario + lo que
 * recibió de servicios que cerraron antes) hacia sus destinos.
 *
 * Los destinos pueden ser centros PRODUCTIVOS o centros de SERVICIO que
 * todavía NO cerraron. Un servicio que ya cerró NO puede recibir (si figura
 * como destino, se lanza error). El fijo y el variable pueden repartirse con
 * bases distintas (como en la pasada directa).
 */
export interface ServiceClosure {
  serviceCenterId: string;
  /** Unidades de base por centro destino (fallback si no se discrimina f/v). */
  distribution: Record<string, Decimal.Value>;
  distributionFixed?: Record<string, Decimal.Value>;
  distributionVariable?: Record<string, Decimal.Value>;
  /** Nombre de la base usada (para mostrar en el árbol). Ej. 'horas máquina'. */
  baseName?: string;
}

export interface StepwiseStep {
  serviceCenterId: string;
  /** Costo acumulado que el servicio tenía al momento de cerrar. */
  distributed: FixedVariable;
  baseName?: string;
  totalBaseFixed: Decimal;
  totalBaseVariable: Decimal;
  /** Cuota = costo ÷ total de la base (para el árbol; sin redondear). */
  quotaFixed: Decimal;
  quotaVariable: Decimal;
  /** Cuánto entregó a cada destino. */
  toTargets: Record<string, FixedVariable>;
}

export interface StepwiseResult {
  /** Costo acumulado por centro tras todos los cierres. Los servicios quedan en 0. */
  byCenter: Record<string, FixedVariable>;
  /** Traza paso a paso, en el orden de cierre (para el árbol de derivación). */
  steps: StepwiseStep[];
}

/**
 * Prorrateo secundario ESCALONADO. Procesa los cierres en el ORDEN dado
 * (`closures[0]` cierra primero). Regla dura de la cátedra: "cerrado no
 * recibe". Discrimina SIEMPRE fijo y variable. Idempotente respecto del orden
 * de entrada (el orden lo define el costista, no el motor).
 *
 * Al terminar, cada centro de servicio queda en 0 y todo su costo vive en los
 * centros productivos (y, transitoriamente, en servicios que aún no habían
 * cerrado). No se pierde ni un centavo: Σ(productivos) = Σ(primario).
 */
export function secondaryProrationStepwise(
  centers: CostCenter[],
  primary: PrimaryProrationResult,
  closures: ServiceClosure[],
): StepwiseResult {
  const centerById = new Map(centers.map((c) => [c.id, c]));

  // Acumulador: arranca en el primario de TODOS los centros.
  const acc: Record<string, FixedVariable> = {};
  for (const c of centers) acc[c.id] = primary[c.id] ?? fvZero();

  const closed = new Set<string>();
  const steps: StepwiseStep[] = [];

  for (const cl of closures) {
    const service = acc[cl.serviceCenterId];
    if (!service) {
      throw new CalcError(`Cierre de un centro inexistente: ${cl.serviceCenterId}`);
    }
    if (closed.has(cl.serviceCenterId)) {
      throw new CalcError(`El centro "${cl.serviceCenterId}" figura dos veces en el orden de cierre`);
    }

    const fixedDist =
      cl.distributionFixed && Object.keys(cl.distributionFixed).length > 0
        ? cl.distributionFixed
        : cl.distribution;
    const variableDist =
      cl.distributionVariable && Object.keys(cl.distributionVariable).length > 0
        ? cl.distributionVariable
        : cl.distribution;

    // Validar destinos: deben existir y NO haber cerrado ya (criterio A.3.c).
    for (const targetId of new Set([...Object.keys(fixedDist), ...Object.keys(variableDist)])) {
      if (!centerById.has(targetId)) {
        throw new CalcError(
          `El centro "${cl.serviceCenterId}" reparte a un centro inexistente: ${targetId}`,
        );
      }
      if (targetId === cl.serviceCenterId) {
        throw new CalcError(`El centro "${cl.serviceCenterId}" no puede repartirse a sí mismo`);
      }
      if (closed.has(targetId)) {
        throw new CalcError(
          `El centro "${targetId}" ya cerró y no puede recibir del centro "${cl.serviceCenterId}" (método escalonado: cerrado no recibe)`,
        );
      }
    }

    const totalBaseFixed = Object.values(fixedDist).reduce(
      (a: Decimal, v) => a.plus(v),
      new Decimal(0),
    );
    const totalBaseVariable = Object.values(variableDist).reduce(
      (a: Decimal, v) => a.plus(v),
      new Decimal(0),
    );

    if (!service.fixed.isZero() && totalBaseFixed.isZero()) {
      throw new CalcError(
        `El centro "${cl.serviceCenterId}" tiene costo fijo pero su base de reparto suma 0`,
      );
    }
    if (!service.variable.isZero() && totalBaseVariable.isZero()) {
      throw new CalcError(
        `El centro "${cl.serviceCenterId}" tiene costo variable pero su base de reparto suma 0`,
      );
    }

    const toTargets: Record<string, FixedVariable> = {};

    if (!totalBaseFixed.isZero() && !service.fixed.isZero()) {
      for (const [targetId, units] of Object.entries(fixedDist)) {
        const share = new Decimal(units).dividedBy(totalBaseFixed);
        const amount = service.fixed.applyRate(share);
        acc[targetId] = {
          fixed: acc[targetId]!.fixed.add(amount),
          variable: acc[targetId]!.variable,
        };
        toTargets[targetId] = {
          fixed: amount,
          variable: toTargets[targetId]?.variable ?? Money.zero(),
        };
      }
    }
    if (!totalBaseVariable.isZero() && !service.variable.isZero()) {
      for (const [targetId, units] of Object.entries(variableDist)) {
        const share = new Decimal(units).dividedBy(totalBaseVariable);
        const amount = service.variable.applyRate(share);
        acc[targetId] = {
          fixed: acc[targetId]!.fixed,
          variable: acc[targetId]!.variable.add(amount),
        };
        toTargets[targetId] = {
          fixed: toTargets[targetId]?.fixed ?? Money.zero(),
          variable: amount,
        };
      }
    }

    steps.push({
      serviceCenterId: cl.serviceCenterId,
      distributed: service,
      baseName: cl.baseName,
      totalBaseFixed,
      totalBaseVariable,
      quotaFixed: totalBaseFixed.isZero()
        ? new Decimal(0)
        : service.fixed.toDecimal().dividedBy(totalBaseFixed),
      quotaVariable: totalBaseVariable.isZero()
        ? new Decimal(0)
        : service.variable.toDecimal().dividedBy(totalBaseVariable),
      toTargets,
    });

    // El servicio cierra: queda en 0.
    acc[cl.serviceCenterId] = fvZero();
    closed.add(cl.serviceCenterId);
  }

  return { byCenter: acc, steps };
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
