import type { Decimal } from 'decimal.js';
import { Money } from '../../domain/value-objects/money.js';
import {
  calcOptimalLot,
  calcStockLedgerPPP,
  type StockLedgerResult,
} from '../../domain/calculations/raw-material.js';
import { calcDirectLabor, type DirectLaborResult } from '../../domain/calculations/direct-labor.js';
import {
  primaryProration,
  secondaryProration,
  secondaryProrationStepwise,
  calcPredeterminedQuota,
  calcVarianceAnalysis,
  fvZero,
  type CostCenter,
  type IndirectCostConcept,
  type FixedVariable,
  type ServiceDistribution,
  type ServiceClosure,
  type PredeterminedQuota,
  type VarianceAnalysis,
} from '../../domain/calculations/indirect-costs.js';
import { MissingAllocationBaseError } from '../../domain/errors/calculation-errors.js';
import {
  calcCostStatement,
  calcGrossMargin,
  checkRawMaterialConsistency,
  type CostStatementResult,
  type MarginResult,
} from '../../domain/calculations/cost-statement.js';
import type {
  RawMaterialConfig,
  RawMaterialSection,
  DirectLaborConfig,
  IndirectCostConfig,
  InventoryInput,
  SecondaryDistributionPair,
} from '../../shared/schemas/cost.schema.js';
import { normalizeServiceDistribution } from '../../shared/schemas/cost.schema.js';

/**
 * Versión del motor de cálculo. Sube con cada cambio de fórmula (no con cada
 * cambio de código): permite saber, mirando un `calculation_run` viejo, con
 * qué lógica se calculó. Ver DECISIONES.md.
 */
export const ENGINE_VERSION = 'v1.0.0';

/**
 * Orquesta el motor de cálculo completo (Hojas 1-4) a partir de la
 * configuración persistida de una estructura de costos. Es una función PURA:
 * recibe configuración + datos de venta, devuelve el resultado consolidado.
 * No toca base de datos ni red — eso vive en el servicio que la invoca.
 */

export interface CalculationInput {
  rawMaterial: RawMaterialSection;
  directLabor: DirectLaborConfig;
  indirectCosts: IndirectCostConfig;
  inventory: InventoryInput;
  sales: {
    unitPrice: number;
    quantity: number;
    /**
     * Unidades PRODUCIDAS del período. Existía de punta a punta —schema, ruta,
     * servicio y trazabilidad— y el motor de Procesos ya la consumía, pero acá no
     * estaba en el tipo: el costo unitario se calculaba con las unidades VENDIDAS.
     *
     * Producir 100 y vender 60 daba un costo unitario 66 % más alto que el real.
     *
     * Si falta, se mantiene el comportamiento anterior y se DICE en el resultado
     * (`unitCost.basadoEn`), en vez de dar un número que parece el costo unitario
     * y no lo es.
     */
    productionQuantity?: number | null;
  };
}

/** Resultado por materia prima (Parte 3.1: N materias primas). */
export interface MaterialResult {
  config: RawMaterialConfig;
  optimalLot: Decimal;
  ledger: StockLedgerResult;
}

export interface CalculationOutput {
  rawMaterialConsumed: number;
  directLaborTotal: number;
  indirectCostsApplied: number;
  productionCost: number;
  costOfGoodsSold: number;
  grossMargin: number;
  grossMarginPct: number;
  /**
   * Controles de consistencia del cálculo. Opcional: las corridas y los períodos
   * congelados ANTES de que esto existiera no lo tienen, y decir `matches: true`
   * sobre un cálculo que nunca se chequeó sería peor que no decir nada.
   */
  consistency?: {
    /** La MP consumida por ficha de stock coincide con la del estado de costos. */
    rawMaterialMatches: boolean;
    /** Diferencia (estado de costos − ficha de stock). Cero cuando coincide. */
    rawMaterialDifference: number;
  };
  detail: {
    rawMaterial: {
      // Agregados (compat con la vista de resultado): lote del primer material,
      // stock final sumado de todas las materias primas.
      optimalLot: number;
      finalStockQty: number;
      finalStockValue: number;
      // Detalle por materia prima (Parte 3.1).
      materials: Array<{
        id?: string;
        code?: string;
        name?: string;
        unit?: string;
        optimalLot: number;
        finalStockQty: number;
        finalStockValue: number;
        consumed: number;
      }>;
    };
    directLabor: {
      workingDays: number;
      paidDays: number;
      itcsPercent: number;
      iapPercent: number;
      hourlyRates: Record<string, number>;
      // Desglose del ITCS para la ficha del departamento (Parte 3.2).
      itcsBreakdown: { certain: number; uncertainRemunerative: number; derived: number; uncertainNonRemunerative: number };
      // Detalle por departamento (Parte 3.2).
      departments: Array<{
        name: string;
        basicRemuneration: number;
        socialChargesCost: number;
        totalMod: number;
        hourlyRate: number;
        budgetedHours: number;
        realHours?: number;
      }>;
      /**
       * CAPACIDAD OCIOSA (cátedra, Clase 10) — la pérdida por horas pagadas que
       * no se le pueden cobrar al producto, abierta POR TIPO DE
       * IMPRODUCTIVIDAD, más el cartel ya redactado para la pantalla.
       *
       * OPCIONAL: los cálculos guardados antes de que esto existiera no lo
       * tienen. Ausente ≠ "no hay ociosidad": la pantalla no muestra el bloque.
       */
      idleCapacity?: {
        paidHours: number;
        productiveHours: number;
        chargeableHours: number;
        idleHours: number;
        /** Costo COMPLETO de MOD, con la ociosidad adentro. */
        fullMod: number;
        /** La pérdida por capacidad ociosa, aislada. */
        idleCost: number;
        /** MOD imputable a las órdenes = `fullMod` − `idleCost`. */
        applicableMod: number;
        hasIdleCapacity: boolean;
        /** Destino contable con el que se calculó ESTE resultado. */
        destination: 'absorbido-en-el-producto' | 'perdida-del-periodo';
        breakdown: Array<{
          tipo: 'tiempos-perdidos-informados' | 'improductividad-oculta';
          label: string;
          hours: number;
          cost: number;
          reasons: Array<{ reason: string; hours: number; cost: number }>;
        }>;
        alert: {
          level: 'advertencia' | 'critico';
          title: string;
          message: string;
          cost: number;
          sharePercent: number;
        } | null;
      };
    };
    indirectCosts: {
      perDepartment: Record<
        string,
        {
          cipTotal: number;
          appliedCip: number;
          budgetVariance: number;
          volumeVariance: number;
          normalCapacity: number;
          actualActivity: number;
          quota: number;
          actualCip: number;
          // Split fijo/variable del presupuesto derivado y de la cuota (Parte 3.3):
          // permiten mostrar la ficha del centro con su fórmula (presup ÷ cap. normal).
          budgetFixed: number;
          budgetVariable: number;
          quotaFixed: number;
          quotaVariable: number;
          overUnderApplied: number; // aplicado − real (sobre/subaplicación)
          /** E3 — faltan datos de cierre (actividad real y/o CIP real): las
           *  variaciones no se calculan y el CIF se aplica a capacidad normal. */
          pendingClosing: boolean;
          /** Sobre qué nivel de actividad se aplicó el CIF al producto. */
          appliedOn: 'actualActivity' | 'normalCapacity';
        }
      >;
    };
    // Costo unitario — el número final de un sistema de costos: cuánto cuesta
    // producir UNA unidad. Se deriva del costo de producción total ÷ unidades
    // producidas (la "Cantidad producida" de la sección Venta). Va en `detail`
    // (JSON persistido) para sobrevivir la recarga sin migración de columna.
    unitCost: {
      unitsProduced: number;
      unitProductionCost: number;  // costo de producción ÷ unidades producidas
      /**
       * Costo de PRODUCTOS TERMINADOS ÷ unidades terminadas.
       *
       * El renglón de arriba (`unitProductionCost`) divide el costo de
       * PRODUCCIÓN DEL PERÍODO, que es la definición de la cátedra —clase 2,
       * práctica resuelta: $2.306.000 ÷ 4.612 kg = $500/kg— y va ANTES de
       * ajustar por producción en proceso. Ese número, por definición, no se
       * mueve cuando queda trabajo a medio terminar.
       *
       * El costo de productos terminados sí pasa por la producción en proceso:
       *
       *     costo de producción + EI prod. en proceso − EF prod. en proceso
       *
       * Es el costo de lo que efectivamente salió terminado, y es el que hay
       * que mirar para poner precio en un período donde no se terminó todo. Se
       * agrega como número aparte en vez de cambiar el de arriba: los dos son
       * renglones distintos del estado de costos y la cátedra los muestra a los
       * dos (issue #89, ADR 0006).
       */
      unitFinishedGoodsCost: number;
      unitCostOfGoodsSold: number; // COGS ÷ unidades producidas
      /**
       * De dónde salió el divisor. `'vendidas'` significa que NO se cargó la
       * cantidad producida y el costo unitario está calculado sobre lo vendido:
       * es correcto solo si se vendió todo lo que se produjo.
       *
       * Se expone para que la pantalla pueda avisarlo. Un costo unitario mal
       * dividido no se ve mal: se ve como un costo unitario.
       */
      basadoEn: 'producidas' | 'vendidas';
    };
  };
  /**
   * Objetos intermedios YA calculados por las funciones puras (ledger,
   * departamentos, cuotas/variaciones por centro, estado de costos). El
   * tree-builder de F2 arma el árbol de `calculation_nodes` a partir de ESTOS
   * objetos — nunca recalcula — para que el árbol persistido y el número
   * final sean, por construcción, la misma fuente de verdad.
   */
  raw: {
    materials: MaterialResult[];
    labor: DirectLaborResult;
    indirectPerDepartment: Record<
      string,
      {
        quota: PredeterminedQuota;
        variance: VarianceAnalysis;
        budget: FixedVariable;
        normalCapacity: number;
        actualActivity: number;
        actualCip: Money;
        pendingClosing: boolean;
      }
    >;
    statement: CostStatementResult;
    margin: MarginResult;
  };
}

/**
 * El resultado tal como se CONGELA en un período cerrado (Fase 4).
 *
 * Se guarda todo menos `raw`: esos objetos (Money, Decimal, ledgers) son andamios
 * intermedios para el árbol de trazabilidad, no números para leer, y guardarlos
 * serializados solo engorda la foto. Lo que un mes cerrado tiene que poder contar
 * —MP, MOD, CIF, costo, CMV, margen y el detalle por MP / departamento / centro—
 * vive entero en el resto del output.
 */
export type FrozenCalculation = Omit<CalculationOutput, 'raw'>;

/**
 * Deriva el reparto PRIMARIO de los conceptos en modo 'base' a partir de las
 * UNIDADES de una base de asignación (ej. superficie o focos por centro). Los
 * porcentajes NO se tipean ni los inventa la IA: el motor los deriva de las
 * unidades (unidad_centro ÷ Σ unidades) al prorratear. Esta función solo vuelca
 * las unidades a `distribution`; el cálculo del % lo hace `primaryProration`.
 *
 * Solo toca los conceptos en modo 'base'. Los de modo 'percent' o 'direct' (o
 * sin modo: default 'percent') quedan EXACTAMENTE igual → cero regresión.
 *
 * Es PURA: recibe un resolvedor sincrónico `resolveUnits` (sin base de datos)
 * para testearse al centavo. Si una base no tiene valores todavía, `resolveUnits`
 * devuelve `undefined` y ese concepto se deja como estaba.
 *
 * @param resolveUnits  baseCode → { centerId: unidades } (o `undefined`).
 */
export function applyPrimaryAllocationBases(
  config: IndirectCostConfig,
  resolveUnits: (baseCode: string) => Record<string, number> | undefined,
): IndirectCostConfig {
  const validIds = new Set(config.centers.map((c) => c.id));
  const concepts = config.concepts.map((c) => {
    if (c.allocationMode !== 'base' || !c.baseCode) return c;
    const units = resolveUnits(c.baseCode);
    if (!units) return c;
    const distribution: Record<string, number> = {};
    for (const [centerId, value] of Object.entries(units)) {
      if (!validIds.has(centerId)) continue; // ignorar centros que no existen
      if (!(value > 0)) continue; // solo unidades positivas suman a la base
      distribution[centerId] = value;
    }
    return { ...c, distribution };
  });
  return { ...config, concepts };
}

/**
 * Deriva el reparto SECUNDARIO de los centros de servicio en modo 'base' a
 * partir de las UNIDADES de una base de asignación (ej. horas-máquina o
 * superficie por centro). Los porcentajes NO se tipean: el motor los deriva de
 * las unidades (unidad_centro ÷ Σ unidades) al hacer el prorrateo. Esta función
 * solo vuelca las unidades a `toProductive`; el cálculo del % lo hace el motor.
 *
 * Solo toca los servicios en modo 'base'. Los de modo 'manual' (o sin modo:
 * default 'manual') quedan EXACTAMENTE igual → cero regresión sobre lo cargado.
 *
 * Es PURA: recibe un resolvedor sincrónico `resolveUnits` (sin base de datos)
 * para poder testearse al centavo. La capa de servicio le pasa las unidades ya
 * leídas de `allocation_base_values`. Si una base no tiene valores todavía,
 * `resolveUnits` devuelve `undefined` y ese servicio se deja como estaba (la
 * validación de insumos detecta el reparto vacío y pide cargar la base).
 *
 * @param resolveUnits  baseCode → { centerId: unidades } (o `undefined`).
 */
export function applySecondaryAllocationBases(
  config: IndirectCostConfig,
  resolveUnits: (baseCode: string) => Record<string, number> | undefined,
): IndirectCostConfig {
  const validIds = new Set(config.centers.map((c) => c.id));
  const serviceDistributions = config.serviceDistributions.map((d) => {
    if (d.distributionMode !== 'base' || !d.baseCode) return d;
    const units = resolveUnits(d.baseCode);
    if (!units) return d;
    // Se vuelcan las unidades a PARES EXPLÍCITOS por centro destino. En modo
    // 'base', el fijo y el variable siguen la MISMA base (mismas unidades).
    const distributions: SecondaryDistributionPair[] = [];
    for (const [centerId, value] of Object.entries(units)) {
      if (centerId === d.serviceCenterId) continue; // un servicio no se reparte a sí mismo
      if (!validIds.has(centerId)) continue; // ignorar centros que no existen
      if (!(value > 0)) continue; // solo unidades positivas suman a la base
      distributions.push({ centroDestinoId: centerId, fijo: value, variable: value });
    }
    return { ...d, distributions };
  });
  return { ...config, serviceDistributions };
}

/**
 * Calcula el PRESUPUESTO (fijo/variable) de cada centro PRODUCTIVO a partir del
 * prorrateo primario + cierre del secundario. Es la "auto-carga" del presupuesto
 * que pide la metodología: el usuario nunca lo tipea a mano. Se usa al guardar la
 * sección de Costos Indirectos para persistir el valor y mostrarlo (solo lectura).
 */
export function computeProductiveBudgets(
  indirectCosts: IndirectCostConfig,
): Record<string, { fixed: number; variable: number }> {
  const productiveCip = resolveProductiveCip(indirectCosts);
  const out: Record<string, { fixed: number; variable: number }> = {};
  for (const [centerId, fv] of Object.entries(productiveCip)) {
    out[centerId] = { fixed: fv.fixed.toNumber(), variable: fv.variable.toNumber() };
  }
  return out;
}

/**
 * Resuelve el CIP acumulado (primario + secundario) de cada centro PRODUCTIVO.
 *
 * Si la config trae `closureOrder` (orden de cierre), usa el método ESCALONADO
 * (criterio A.3.c): un servicio puede repartir a otro que aún no cerró. Si no,
 * usa la pasada directa legada (retrocompatible con FX1/FX3 y estructuras ya
 * cargadas). Es la única fuente del presupuesto productivo: el usuario nunca lo
 * tipea (criterio A.3).
 */
/**
 * Vuelca los PARES EXPLÍCITOS `{ centroDestinoId, fijo, variable }` a los
 * Records keyed by id que consume el motor (`toProductiveFixed`/`Variable` en la
 * pasada directa, `distributionFixed`/`Variable` en el escalonado). Se ignoran
 * los pares en cero (no reparten nada): así una columna vacía no dispara la
 * validación de destino. La clave SIEMPRE es el `centroDestinoId` explícito del
 * par — nunca una posición —, que es lo que elimina el bug de desfasaje.
 */
function pairsToFixedRecord(pairs: SecondaryDistributionPair[]): Record<string, number> {
  const r: Record<string, number> = {};
  for (const p of pairs) if (p.fijo > 0) r[p.centroDestinoId] = p.fijo;
  return r;
}
function pairsToVariableRecord(pairs: SecondaryDistributionPair[]): Record<string, number> {
  const r: Record<string, number> = {};
  for (const p of pairs) if (p.variable > 0) r[p.centroDestinoId] = p.variable;
  return r;
}

export function resolveProductiveCip(
  indirectCosts: IndirectCostConfig,
): Record<string, FixedVariable> {
  const centers: CostCenter[] = indirectCosts.centers;
  const concepts: IndirectCostConcept[] = indirectCosts.concepts.map((c) => ({
    name: c.name,
    amount: { fixed: Money.of(c.amount.fixed), variable: Money.of(c.amount.variable) },
    distribution: c.distribution,
  }));
  const primary = primaryProration(centers, concepts);

  // Normalizar a PARES EXPLÍCITOS. Es idempotente si la config ya vino parseada
  // por el schema (caso de producción); también convierte una config LEGADA por
  // Records (retrocompat) o una armada a mano en un test. Nunca hay mapeo por
  // posición: la clave es siempre el `centroDestinoId` explícito.
  const entries = indirectCosts.serviceDistributions.map(normalizeServiceDistribution);

  const order = indirectCosts.closureOrder ?? [];
  if (order.length === 0) {
    // Pasada directa servicio→productivo. Cada servicio reparte por PARES
    // EXPLÍCITOS (fijo/variable por centro destino), nunca por posición.
    const dists: ServiceDistribution[] = entries.map((d) => ({
      serviceCenterId: d.serviceCenterId,
      toProductive: {},
      toProductiveFixed: pairsToFixedRecord(d.distributions),
      toProductiveVariable: pairsToVariableRecord(d.distributions),
    }));
    return secondaryProration(centers, primary, dists);
  }

  // Camino escalonado: construir los cierres en el orden pedido.
  const distById = new Map(entries.map((d) => [d.serviceCenterId, d]));
  const nameById = new Map(centers.map((c) => [c.id, c.name]));
  const closures: ServiceClosure[] = order.map((serviceCenterId) => {
    const d = distById.get(serviceCenterId);
    if (!d) {
      const serviceName = nameById.get(serviceCenterId) ?? serviceCenterId;
      throw new MissingAllocationBaseError(
        serviceCenterId,
        `El centro de servicio «${serviceName}» está en el orden de cierre pero no tiene reparto secundario cargado. Cargá a qué centros reparte «${serviceName}» y volvé a guardar Costos Indirectos.`,
      );
    }
    return {
      serviceCenterId,
      distribution: {},
      distributionFixed: pairsToFixedRecord(d.distributions),
      distributionVariable: pairsToVariableRecord(d.distributions),
      baseName: d.baseCode,
    };
  });

  const { byCenter } = secondaryProrationStepwise(centers, primary, closures);
  const out: Record<string, FixedVariable> = {};
  for (const c of centers) {
    if (c.type === 'productive') out[c.id] = byCenter[c.id] ?? fvZero();
  }
  return out;
}

export function runCalculation(input: CalculationInput): CalculationOutput {
  // --- Hoja 1: Materia Prima (N materias primas, Parte 3.1) ---
  const materials: MaterialResult[] = input.rawMaterial.materials.map((m) => ({
    config: m,
    optimalLot: calcOptimalLot(m.wilson),
    ledger: calcStockLedgerPPP(m.initialStock.quantity, m.initialStock.unitCost, m.movements),
  }));
  // MP consumida total = Σ del consumo valuado a PPP de cada materia prima.
  const rawMaterialConsumed = Money.sum(materials.map((x) => x.ledger.rawMaterialConsumed));

  // --- Hoja 2: Mano de Obra Directa ---
  const labor = calcDirectLabor(input.directLabor);
  const directLaborTotal = labor.totalMod;

  // --- Hoja 3: Costos Indirectos ---
  // El CIP productivo (presupuesto) sale del prorrateo: escalonado si hay orden
  // de cierre, directo si no. El usuario nunca lo tipea (criterio A.3).
  const productiveCip = resolveProductiveCip(input.indirectCosts);

  const perDepartment: CalculationOutput['detail']['indirectCosts']['perDepartment'] = {};
  const indirectPerDepartment: CalculationOutput['raw']['indirectPerDepartment'] = {};
  let indirectCostsApplied = Money.zero();

  // Nombre humano de cada centro: lo que ve el costista cuando el motor corta.
  // El id interno (prod1, serv2…) nunca sale en un mensaje (F09-4).
  const centerNameById = new Map(input.indirectCosts.centers.map((c) => [c.id, c.name]));

  for (const setting of input.indirectCosts.productiveSettings) {
    // PRESUPUESTO del centro = resultado del prorrateo (primario + cierre del
    // secundario). NO es un dato manual: se deriva automáticamente. Si el centro
    // no figura en el prorrateo, se cae al valor manual persistido como respaldo.
    const prorated = productiveCip[setting.centerId];
    const budget: FixedVariable = prorated ?? {
      fixed: Money.of(setting.budget?.fixed ?? 0),
      variable: Money.of(setting.budget?.variable ?? 0),
    };
    const quota = calcPredeterminedQuota(budget, setting.normalCapacity);

    // CIP REAL = dato de cierre de mes ingresado por el usuario. Es lo que se
    // compara contra el presupuesto para obtener la variación de presupuesto.
    const actualCip = Money.of(setting.actualCip);

    // E3 — ACTIVIDAD REAL y CIP REAL son datos de CIERRE de mes: durante el mes
    // todavía no existen. "Todavía no lo sé" NO es lo mismo que "es cero":
    //
    //   · Sin actividad real, el CIF se aplica sobre la CAPACIDAD NORMAL (costo
    //     predeterminado puro). Antes se aplicaba sobre cero → el producto salía
    //     costeado SIN CIF y sin ningún aviso.
    //   · Sin CIP real no hay contra qué comparar: las variaciones quedan en cero
    //     y el centro se marca como PENDIENTE DE CIERRE, en vez de mostrar una
    //     variación fantasma calculada contra cero.
    const hasActualActivity = setting.actualActivity > 0;
    const hasActualCip = actualCip.toNumber() > 0;
    const pendingClosing = !hasActualActivity || !hasActualCip;

    // Nivel de actividad con el que se aplica el CIF al producto.
    const applicationLevel = hasActualActivity ? setting.actualActivity : setting.normalCapacity;
    const cipApplied = quota.totalQuota.multiply(applicationLevel);

    // Las variaciones solo tienen sentido con el cierre cargado.
    const variance: VarianceAnalysis = pendingClosing
      ? {
          cipApplied,
          overUnderApplied: Money.zero(),
          budgetVariance: Money.zero(),
          volumeVariance: Money.zero(),
        }
      : calcVarianceAnalysis(
          quota,
          budget,
          setting.normalCapacity,
          setting.actualActivity,
          actualCip,
          centerNameById.get(setting.centerId),
        );

    indirectCostsApplied = indirectCostsApplied.add(variance.cipApplied);

    perDepartment[setting.centerId] = {
      cipTotal: actualCip.toNumber(),
      appliedCip: variance.cipApplied.toNumber(),
      budgetVariance: variance.budgetVariance.toNumber(),
      volumeVariance: variance.volumeVariance.toNumber(),
      normalCapacity: setting.normalCapacity,
      actualActivity: setting.actualActivity,
      quota: quota.totalQuota.toNumber(),
      actualCip: actualCip.toNumber(),
      budgetFixed: budget.fixed.toNumber(),
      budgetVariable: budget.variable.toNumber(),
      quotaFixed: quota.fixedQuota.toNumber(),
      quotaVariable: quota.variableQuota.toNumber(),
      overUnderApplied: variance.overUnderApplied.toNumber(),
      pendingClosing,
      appliedOn: hasActualActivity ? 'actualActivity' : 'normalCapacity',
    };
    indirectPerDepartment[setting.centerId] = {
      quota,
      variance,
      budget,
      normalCapacity: setting.normalCapacity,
      actualActivity: setting.actualActivity,
      actualCip,
      pendingClosing,
    };
  }

  // --- Hoja 4: Estado de Costos ---
  // MP: para el estado usamos la valuación de la ficha (Ex.Inicial + Compras − Ex.Final
  // equivale al consumo de la ficha PPP, ya validado por consistencia). Con N
  // materias primas, se suma cada componente entre todas.
  const initialRM = Money.sum(
    materials.map((x) =>
      Money.of(x.config.initialStock.unitCost).multiply(x.config.initialStock.quantity),
    ),
  );
  const purchases = Money.sum(
    materials.flatMap((x) =>
      x.config.movements
        .filter((m) => m.type === 'purchase')
        .map((m) => Money.of(m.unitCost ?? 0).multiply(m.quantity)),
    ),
  );
  const finalRM = Money.sum(materials.map((x) => x.ledger.finalBalanceValue));

  const statement = calcCostStatement({
    initialRawMaterial: initialRM,
    rawMaterialPurchases: purchases,
    finalRawMaterial: finalRM,
    directLabor: directLaborTotal,
    indirectCostsApplied,
    initialWorkInProcess: Money.of(input.inventory.initialWorkInProcess),
    finalWorkInProcess: Money.of(input.inventory.finalWorkInProcess),
    initialFinishedGoods: Money.of(input.inventory.initialFinishedGoods),
    finalFinishedGoods: Money.of(input.inventory.finalFinishedGoods),
  });

  // --- Margen ---
  const salesRevenue = Money.of(input.sales.unitPrice).multiply(input.sales.quantity);
  const margin = calcGrossMargin(salesRevenue, statement.costOfGoodsSold);

  const hourlyRates: Record<string, number> = {};
  for (const d of labor.departments) {
    hourlyRates[d.name] = d.hourlyRate.toNumber();
  }

  // --- Costo unitario de producción (el número final del sistema) ---
  // costo de producción total ÷ unidades producidas. Guarda contra división por
  // cero: si todavía no se cargó la cantidad producida, el unitario queda en 0.
  // Las PRODUCIDAS son el divisor correcto del costo unitario. Solo si no se
  // cargaron se cae a las vendidas, y queda dicho en `basadoEn`.
  const cantidadProducida = input.sales.productionQuantity;
  const hayProducidas = cantidadProducida != null && cantidadProducida > 0;
  const unitsProduced = hayProducidas ? cantidadProducida : (input.sales.quantity ?? 0);
  const basadoEn: 'producidas' | 'vendidas' = hayProducidas ? 'producidas' : 'vendidas';
  const unitProductionCost = unitsProduced > 0
    ? statement.productionCost.divide(unitsProduced).toNumber()
    : 0;
  // Costo unitario de PRODUCTOS TERMINADOS (#89). El numerador ya lo calculaba
  // `cost-statement.ts` —costo de producción + EI prod. en proceso − EF prod. en
  // proceso— y no se usaba en ningún lado: era el único número del motor donde
  // la producción en proceso podía entrar, y no entraba a ninguno.
  const unitFinishedGoodsCost = unitsProduced > 0
    ? statement.finishedGoodsCost.divide(unitsProduced).toNumber()
    : 0;
  const unitCostOfGoodsSold = unitsProduced > 0
    ? statement.costOfGoodsSold.divide(unitsProduced).toNumber()
    : 0;

  // CHEQUEO DE CONSISTENCIA DE MATERIA PRIMA.
  //
  // La MP consumida se puede saber por dos caminos, y tienen que dar lo mismo:
  //   (a) sumando lo que cada ficha de stock (PPP) dice que salió, y
  //   (b) Existencia inicial + Compras − Existencia final, del estado de costos.
  //
  // Si difieren, hay una inconsistencia real en los datos —un movimiento que no
  // se reflejó en el stock, una existencia final pisada a mano— y el costo está
  // mal por esa diferencia. La cátedra pide este control expresamente.
  //
  // La función ya existía, con tests, y NO SE LLAMABA DESDE NINGÚN LADO: el
  // sistema tenía el detector de inconsistencias apagado. Se engancha acá, que
  // es donde están los dos números.
  //
  // NO bloquea el cálculo: informa. Un costista al que le frenan el cálculo por
  // una diferencia de redondeo no puede trabajar; uno al que se le avisa, sí.
  const rmConsistency = checkRawMaterialConsistency(
    statement.rawMaterialConsumed,
    rawMaterialConsumed,
  );

  return {
    rawMaterialConsumed: rawMaterialConsumed.toNumber(),
    directLaborTotal: directLaborTotal.toNumber(),
    indirectCostsApplied: indirectCostsApplied.toNumber(),
    productionCost: statement.productionCost.toNumber(),
    costOfGoodsSold: statement.costOfGoodsSold.toNumber(),
    grossMargin: margin.grossMargin.toNumber(),
    grossMarginPct: margin.grossMarginPct.toPercent(),
    consistency: {
      rawMaterialMatches: rmConsistency.matches,
      rawMaterialDifference: rmConsistency.difference.toNumber(),
    },
    detail: {
      rawMaterial: {
        optimalLot: materials[0]?.optimalLot.toNumber() ?? 0,
        finalStockQty: materials.reduce((a, x) => a + x.ledger.finalBalanceQty.toNumber(), 0),
        finalStockValue: finalRM.toNumber(),
        materials: materials.map((x) => ({
          id: x.config.id,
          code: x.config.code,
          name: x.config.name,
          unit: x.config.unit,
          optimalLot: x.optimalLot.toNumber(),
          finalStockQty: x.ledger.finalBalanceQty.toNumber(),
          finalStockValue: x.ledger.finalBalanceValue.toNumber(),
          consumed: x.ledger.rawMaterialConsumed.toNumber(),
        })),
      },
      directLabor: {
        workingDays: labor.workingDays.effectiveWorkDays.toNumber(),
        // Días de ausentismo pago (numerador del IAP). Se expone para poder
        // mostrar la fórmula completa "IAP = días pagos / días efectivos".
        paidDays: labor.workingDays.totalPaidAbsence.toNumber(),
        itcsPercent: labor.itcs.itcs.toPercent(),
        // IAP — Índice de Ausentismo Pago (ya calculado en calcWorkingDays, se expone
        // para mostrarlo en el resultado). No cambia ninguna fórmula.
        iapPercent: labor.workingDays.iap.toPercent(),
        hourlyRates,
        itcsBreakdown: {
          certain: labor.itcs.certainCharges.toPercent(),
          uncertainRemunerative: labor.itcs.uncertainRemunerativeCoefs.toPercent(),
          derived: labor.itcs.derivedCharges.toPercent(),
          uncertainNonRemunerative: labor.itcs.uncertainNonRemunerative.toPercent(),
        },
        departments: labor.departments.map((d, i) => ({
          name: d.name,
          basicRemuneration: d.basicRemuneration.toNumber(),
          socialChargesCost: d.socialChargesCost.toNumber(),
          totalMod: d.totalMod.toNumber(),
          hourlyRate: d.hourlyRate.toNumber(),
          budgetedHours: d.hoursWorked.toNumber(),
          realHours: input.directLabor.departments[i]?.realHours,
        })),
        idleCapacity: {
          paidHours: labor.idleCapacity.paidHours.toNumber(),
          productiveHours: labor.idleCapacity.productiveHours.toNumber(),
          chargeableHours: labor.idleCapacity.chargeableHours.toNumber(),
          idleHours: labor.idleCapacity.idleHours.toNumber(),
          fullMod: labor.idleCapacity.fullMod.toNumber(),
          idleCost: labor.idleCapacity.idleCost.toNumber(),
          applicableMod: labor.idleCapacity.applicableMod.toNumber(),
          hasIdleCapacity: labor.idleCapacity.hasIdleCapacity,
          destination: labor.idleCapacity.destination,
          breakdown: labor.idleCapacity.breakdown.map((b) => ({
            tipo: b.tipo,
            label: b.label,
            hours: b.hours.toNumber(),
            cost: b.cost.toNumber(),
            reasons: b.reasons.map((r) => ({
              reason: r.reason,
              hours: r.hours.toNumber(),
              cost: r.cost.toNumber(),
            })),
          })),
          alert: labor.idleCapacity.alert
            ? {
                level: labor.idleCapacity.alert.level,
                title: labor.idleCapacity.alert.title,
                message: labor.idleCapacity.alert.message,
                cost: labor.idleCapacity.alert.cost.toNumber(),
                sharePercent: labor.idleCapacity.alert.sharePercent.toNumber(),
              }
            : null,
        },
      },
      indirectCosts: { perDepartment },
      unitCost: {
        unitsProduced,
        unitProductionCost,
        unitFinishedGoodsCost,
        unitCostOfGoodsSold,
        basadoEn,
      },
    },
    raw: { materials, labor, indirectPerDepartment, statement, margin },
  };
}
