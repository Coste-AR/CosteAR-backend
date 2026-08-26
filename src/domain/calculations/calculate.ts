import { Decimal } from 'decimal.js';
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
  imputarDesperdicios,
  type DesperdicioRegistrado,
  type ImputacionDesperdicio,
} from '../../domain/calculations/desperdicio.js';
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
  /**
   * Desperdicio declarado del período (issue #92, regla R5 de la clase 4).
   *
   * `desperdicio.ts` implementaba R5 desde hacía tiempo y **su único importador
   * era su propio test**: el motor no tenía dónde recibir el dato. Acá está.
   *
   * Opcional: sin desperdicios declarados el cálculo da exactamente lo mismo que
   * antes. Un registro SIN naturaleza declarada no entra al cálculo y queda
   * listado como pendiente — elegir por el costista sería peor que no calcular.
   */
  desperdicios?: DesperdicioRegistrado[];
  /**
   * TRABAJOS DE TERCEROS del período (#90, ADR 0009): procesos mandados a hacer
   * afuera que son parte del costo de producción.
   *
   * Es un dato PROPIO del período, no una parte de los costos indirectos: la
   * cátedra (clase 20) los registra por separado de los CIP porque no se
   * prorratean entre centros ni generan cuotas. Por eso entra acá y no dentro de
   * `indirectCosts` — si viviera ahí, la próxima persona lo sumaría a los
   * conceptos "para simplificar" y se diluiría en las cuotas.
   */
  thirdPartyWork?: number | null;
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
  /** Costo NORMAL de producción: MP + MOD + CIP aplicados, sin la variación presupuesto. */
  productionCost: number;
  /**
   * Σ variación presupuesto de los centros que cerraron el período (#90).
   * Positiva = costó más de lo presupuestado y encarece el costo real.
   *
   * OPCIONAL: los cálculos guardados antes de que este renglón existiera no lo
   * tienen, y decir "cero" sobre un cálculo que nunca lo consideró sería
   * afirmar que no hubo variación cuando lo que pasa es que no se midió.
   */
  budgetVariance?: number;
  /**
   * Trabajos de terceros del período (#90). Se exponen aparte porque son un
   * renglón propio del estado de costos, no un CIP más.
   */
  thirdPartyWork?: number;
  /** Costo REAL = normal + trabajos de terceros + variación presupuesto (#90). */
  realProductionCost?: number;
  /**
   * Desperdicio del período imputado según R5 (#92). Las dos cifras van
   * SEPARADAS a propósito: una es costo del producto y la otra es pérdida de la
   * empresa, y mezclarlas esconde exactamente lo que el costista tiene que ver.
   *
   * OPCIONAL: los cálculos anteriores a que esto existiera no lo tienen, y no es
   * lo mismo "no hubo desperdicio" que "no se midió".
   */
  desperdicio?: {
    /** Merma normal neta de recupero: la absorben las unidades buenas. Ya está en el costo. */
    alCosto: number;
    /** Merma extraordinaria: pérdida del período. Se sacó del costo. */
    alResultado: number;
    /** Recupero restado del costo de materiales. */
    recuperoAplicado: number;
    /** Registros sin naturaleza declarada: no entraron al cálculo, y por qué. */
    pendientes: { concepto: string; valor: number; motivo: string }[];
  };
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
      /**
       * Costo de productos terminados y VENDIDOS ÷ unidades VENDIDAS.
       *
       * El divisor es distinto del de los dos renglones de arriba a propósito:
       * el CPV es el costo de lo que se vendió, no de lo que se produjo. Con la
       * valuación consistente —lo producido y no vendido queda en existencia
       * final de productos terminados— este número da igual que el costo
       * unitario de producción: una unidad no cambia de costo por haberse
       * vendido (issue #88).
       */
      unitCostOfGoodsSold: number;
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

/**
 * Guarda de completitud del prorrateo secundario (H-L1).
 *
 * El secundario tiene que transferir el costo COMPLETO de los centros de
 * servicio a los productivos: lo que no se reparte, no desaparece del negocio
 * —desaparece del cálculo—, y sale por menos costo unitario. Es el peor modo
 * de fallar que puede tener este motor: sin error, con un número más chico.
 *
 * Los dos métodos tenían el mismo agujero por puertas distintas:
 *
 * - Pasada DIRECTA: `secondaryProration` itera sobre las distribuciones
 *   cargadas. Un servicio SIN entrada no se recorre nunca y su primario queda
 *   afuera. (Un servicio CON entrada pero con base total 0 tampoco repartía,
 *   por el `if (!totalBase...)` que protege la división.)
 * - Pasada ESCALONADA: itera sobre `closureOrder`. Un servicio que no está en
 *   el orden nunca cierra, su costo queda en `byCenter[servicio]`, y como acá
 *   abajo solo se copian los centros productivos, se pierde igual. La
 *   validación de "reparto vacío" de `secondaryProrationStepwise` solo alcanza
 *   a los que SÍ están en el orden.
 *
 * Por eso la guarda vive acá y no adentro de cada pasada: este es el único
 * punto que conoce a la vez el universo de centros, su costo primario y qué
 * método se va a usar. Chequear fijo y variable por separado replica la
 * granularidad que el escalonado ya usa.
 */
function assertSecundarioCompleto(
  centers: CostCenter[],
  primary: Record<string, FixedVariable>,
  repartenFijo: Set<string>,
  repartenVariable: Set<string>,
): void {
  for (const c of centers) {
    if (c.type !== 'service') continue;
    const costo = primary[c.id];
    if (!costo) continue;
    const nombre = c.name?.trim() || 'un centro de servicio';

    if (!costo.fixed.isZero() && !repartenFijo.has(c.id)) {
      throw new MissingAllocationBaseError(
        c.id,
        `El centro de servicio «${nombre}» tiene costo fijo del prorrateo primario pero no reparte a ningún centro. ` +
          `Sin ese reparto su costo no llega a los centros productivos y el costo unitario sale más bajo de lo que es. ` +
          `Cargá a qué centros reparte «${nombre}» y volvé a guardar Costos Indirectos.`,
      );
    }
    if (!costo.variable.isZero() && !repartenVariable.has(c.id)) {
      throw new MissingAllocationBaseError(
        c.id,
        `El centro de servicio «${nombre}» tiene costo variable del prorrateo primario pero no reparte a ningún centro. ` +
          `Sin ese reparto su costo no llega a los centros productivos y el costo unitario sale más bajo de lo que es. ` +
          `Cargá a qué centros reparte «${nombre}» y volvé a guardar Costos Indirectos.`,
      );
    }
  }
}

/**
 * Control de cierre del secundario (H-L1): Σ primario de TODOS los centros
 * tiene que ser igual a Σ CIP de los productivos después de repartir.
 *
 * La guarda de arriba nombra al centro culpable —que es lo que el usuario
 * necesita— pero solo cubre las formas de perder costo que ya conocemos. Este
 * control cubre las que no: si alguna vez se escapa un peso por otro camino,
 * salta acá en vez de salir por un costo unitario más chico.
 *
 * Mismo espíritu que `checkRawMaterialConsistency`, que ya existía en el motor
 * y que fue un defecto real el día que estuvo apagado.
 *
 * TOLERANCIA: acá no se puede comparar con `isZero()` exacto como hace la
 * consistencia de materia prima, porque el reparto DIVIDE. Repartir $100 entre
 * tres centros da tres cuotas de 33.333…(28 dígitos, la precisión de
 * decimal.js) que sumadas no vuelven a dar $100 exacto: sobra o falta algo del
 * orden de 1e-25. Ese residuo no es costo perdido, es aritmética. Se tolera
 * medio centavo, que es varios órdenes de magnitud más que el residuo y varios
 * menos que cualquier pérdida real: un servicio que no reparte deja afuera su
 * costo primario entero, no una fracción de centavo.
 */
const TOLERANCIA_CIERRE_SECUNDARIO = new Decimal('0.005');

function assertSecundarioNoPierdeCosto(
  centers: CostCenter[],
  primary: Record<string, FixedVariable>,
  productivo: Record<string, FixedVariable>,
): void {
  const totalPrimario = Money.sum(centers.map((c) => primary[c.id]?.fixed ?? Money.zero())).add(
    Money.sum(centers.map((c) => primary[c.id]?.variable ?? Money.zero())),
  );
  const totalProductivo = Money.sum(Object.values(productivo).map((v) => v.fixed)).add(
    Money.sum(Object.values(productivo).map((v) => v.variable)),
  );
  const diferencia = totalPrimario.subtract(totalProductivo);
  if (diferencia.toDecimal().abs().greaterThan(TOLERANCIA_CIERRE_SECUNDARIO)) {
    throw new MissingAllocationBaseError(
      'indirectCosts.serviceDistributions',
      `El prorrateo secundario no cierra: llegaron ${totalProductivo.toFixed()} a los centros productivos de un ` +
        `total primario de ${totalPrimario.toFixed()} (diferencia ${diferencia.toFixed()}). Revisá que todos los ` +
        `centros de servicio repartan su costo y volvé a guardar Costos Indirectos.`,
    );
  }
}

export function resolveProductiveCip(
  indirectCosts: IndirectCostConfig,
): Record<string, FixedVariable> {
  const centers: CostCenter[] = indirectCosts.centers;
  const concepts: IndirectCostConcept[] = indirectCosts.concepts.map((c) => ({
    name: c.name,
    amount: { fixed: Money.of(c.amount.fixed), variable: Money.of(c.amount.variable) },
    distribution: c.distribution,
    // Sin esto el motor no distingue 'direct' y renormaliza los importes ya
    // asignados, reescribiendo en silencio lo que el costista declaró.
    allocationMode: c.allocationMode,
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
    // H-L1: un servicio sin entrada acá —o con la entrada vacía— no se recorre
    // y su costo primario se pierde en silencio. Solo cuentan como "reparten"
    // los que tienen al menos un destino con importe.
    assertSecundarioCompleto(
      centers,
      primary,
      new Set(dists.filter((d) => Object.keys(d.toProductiveFixed ?? {}).length > 0).map((d) => d.serviceCenterId)),
      new Set(
        dists.filter((d) => Object.keys(d.toProductiveVariable ?? {}).length > 0).map((d) => d.serviceCenterId),
      ),
    );
    const directo = secondaryProration(centers, primary, dists);
    assertSecundarioNoPierdeCosto(centers, primary, directo);
    return directo;
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

  // H-L1 por la otra puerta: `secondaryProrationStepwise` valida el reparto
  // vacío SOLO de los servicios que están en `closureOrder`. Un servicio que no
  // figura en el orden nunca cierra, su costo se queda en `byCenter[servicio]`
  // y acá abajo, que copia únicamente los productivos, se pierde en silencio.
  // Para el escalonado "reparte" significa "está en el orden de cierre".
  const enElOrden = new Set(order);
  assertSecundarioCompleto(centers, primary, enElOrden, enElOrden);

  const { byCenter } = secondaryProrationStepwise(centers, primary, closures);
  const out: Record<string, FixedVariable> = {};
  for (const c of centers) {
    if (c.type === 'productive') out[c.id] = byCenter[c.id] ?? fvZero();
  }
  assertSecundarioNoPierdeCosto(centers, primary, out);
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
  /** Σ variación presupuesto de los centros que cerraron (#90). Ver el estado de costos. */
  let budgetVarianceTotal = Money.zero();

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
    // (#90) La variación PRESUPUESTO va al estado de costos: es lo que costó de
    // más —o de menos— hacer lo que se hizo, y es costo del producto. Los
    // centros pendientes de cierre aportan cero, porque su variación ES cero:
    // sin CIP real no hay contra qué comparar.
    //
    // La variación VOLUMEN no se toca acá a propósito. Va al estado de
    // resultados como pérdida del período (capacidad ociosa), y la cátedra
    // marca justamente esa confusión como la que más se olvida.
    budgetVarianceTotal = budgetVarianceTotal.add(variance.budgetVariance);

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

  // --- Desperdicio del período (R5, clase 4) ---
  // `imputarDesperdicios` reparte cada registro entre costo y resultado según su
  // naturaleza DECLARADA, y deja aparte los que no la tienen. Se llama siempre:
  // sin registros devuelve todo en cero y el cálculo no cambia.
  const desperdicio: ImputacionDesperdicio = imputarDesperdicios(input.desperdicios ?? []);

  const statement = calcCostStatement({
    initialRawMaterial: initialRM,
    rawMaterialPurchases: purchases,
    finalRawMaterial: finalRM,
    directLabor: directLaborTotal,
    indirectCostsApplied,
    // #90 — Trabajos de terceros. Van por SEPARADO de los CIP: no pasaron por
    // el prorrateo ni por las cuotas, así que se suman acá enteros. Si se
    // hubieran tratado como un concepto de CIF, ya estarían repartidos entre los
    // centros y sumarlos otra vez sería contarlos dos veces.
    thirdPartyWork: Money.of(input.thirdPartyWork ?? 0),
    budgetVariance: budgetVarianceTotal,
    // R5 (#92). La merma NORMAL no se pasa a propósito: ya está adentro del
    // costo —se consumió— y las unidades buenas la absorben sin cálculo
    // adicional, igual que en Procesos. Lo que se resta es su recupero y la
    // merma extraordinaria, que nunca es costo.
    wasteRecovery: Money.of(desperdicio.recuperoAplicado),
    extraordinaryLoss: Money.of(desperdicio.alResultado),
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
  // El CPV unitario se divide por las unidades VENDIDAS (#88). El CPV es el
  // costo de las unidades que se vendieron: dividirlo por las producidas da el
  // costo unitario escalado por la proporción de venta, que no es el costo de
  // nada. Producir 100 y vender 60 lo dejaba 40 % subvaluado.
  //
  // Los dos divisores vivían en una sola variable. Cuando `3b9e8ae` arregló el
  // costo unitario de producción cambiándola a las producidas —arreglo correcto,
  // no hay que revertirlo—, este número heredó el error que el otro dejó de
  // tener. Por eso ahora son dos variables distintas, cada una con su
  // significado, y no una compartida.
  const unidadesVendidas = input.sales.quantity ?? 0;
  const unitCostOfGoodsSold = unidadesVendidas > 0
    ? statement.costOfGoodsSold.divide(unidadesVendidas).toNumber()
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
    thirdPartyWork: statement.thirdPartyWork.toNumber(),
    budgetVariance: statement.budgetVariance.toNumber(),
    realProductionCost: statement.realProductionCost.toNumber(),
    desperdicio,
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
