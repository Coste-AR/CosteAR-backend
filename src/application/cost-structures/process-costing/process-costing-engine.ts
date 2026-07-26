import { Decimal } from 'decimal.js';
import {
  buildUnitMovementSchedule,
  calcEquivalentProduction,
  calcTransferredCost,
  buildProductionCostReport,
  type UnitMovementSchedule,
  type EquivalentProductionSchedule,
  type EquivalentProductionInput,
  type TransferredCost,
  type ProductionCostReport,
  type ProductionCostElementCost,
  type PreviousDepartmentCostInput,
} from '../../../domain/calculations/process-costing.js';
import {
  allocateJointCosts,
  type JointAllocationMethod,
  type JointProduct,
  type JointCostAllocationResult,
} from '../../../domain/calculations/joint-costs.js';
import { ProcessValidationError } from '../../../domain/errors/calculation-errors.js';
import type { CostingEngine, CostingResult } from '../costing-engine.js';
import type { TreeNode } from '../tree-builder.js';

/**
 * COSTEO POR PROCESOS · MOTOR (B17) — implementación Strategy del `CostingEngine`.
 *
 * Es el orquestador que hace CALCULABLE de punta a punta una estructura de
 * Procesos: recorre los departamentos EN ORDEN DE SECUENCIA y, para cada uno,
 * encadena las funciones PURAS del dominio ya verificadas contra la cátedra
 * (Azur Alcoholes):
 *
 *   a. `buildUnitMovementSchedule`  — cuadro de movimiento de unidades (B06)
 *   b. `calcEquivalentProduction`   — producción equivalente (B07)
 *   c. pérdidas normal/extraordinaria — vienen resueltas dentro del cuadro (B08,
 *      `buildUnitMovementSchedule` delega en `calcNormalAndExtraordinaryLosses`)
 *   d. `calcTransferredCost`        — costo modificado + CAUP del anterior (B09)
 *   e. `buildProductionCostReport`  — informe con la doble verificación de la EF (B10)
 *
 * El "terminadas y transferidas" del departamento N alimenta el "costo del
 * departamento anterior" de N+1. El primer departamento no tiene costo previo.
 * Donde un departamento es punto de separación (`jointAllocation`), reparte su
 * costo conjunto entre los productos con `allocateJointCosts` (B11/B16).
 *
 * Es PURO (sin Prisma, sin HTTP, igual que el motor de Órdenes): recibe los
 * insumos ya resueltos por departamento y devuelve `{ results, tree }`. La
 * persistencia, la auditoría y la marca de incompletitud viven fuera, en el
 * servicio que lo invoca. Lanza `ProcessValidationError` (422) ante cualquier
 * configuración imposible — nunca un 500 crudo.
 */

/** Versión propia del motor de Procesos (independiente del de Órdenes). */
export const PROCESS_ENGINE_VERSION = 'process-v1.0.0';

/** Unidades del cuadro de movimiento de UN departamento (insumos de B06). */
export interface ProcessDepartmentUnits {
  initialWip?: number;
  startedInProduction?: number;
  receivedFromPrevious?: number;
  unitIncrease?: number;
  transferredOut?: number;
  finishedInStock?: number;
  normalLossPct?: number;
  totalLossReported?: number;
  finalWip?: number;
}

/**
 * Costos por elemento del departamento (inventario inicial + período). Se guardan
 * MP / MO / CIF por separado (como la tabla `UnitMovementSchedule`); el motor los
 * combina en "Costo de Conversión (CC)" cuando el departamento sigue la
 * conversión unificada, o los deja separados como MOD / CIP si no.
 */
export interface ProcessElementCosts {
  mpInicial?: number;
  mpPeriodo?: number;
  moInicial?: number;
  moPeriodo?: number;
  cifInicial?: number;
  cifPeriodo?: number;
}

/** Reparto de costos conjuntos de un departamento que es punto de separación (B11/B16). */
export interface ProcessJointAllocationInput {
  method: JointAllocationMethod;
  jointCostTotal: number;
  products: JointProduct[];
}

/** Insumos YA RESUELTOS de UN departamento para UN período. */
export interface ProcessDepartmentInput {
  /** Id del departamento (para armar la clave de trazabilidad de sus datos). */
  id: string;
  /** Nombre para mostrar (encabeza la raíz del árbol). */
  name: string;
  /** Posición en la cadena. 1 = departamento inicial. */
  sequence: number;
  /** true = una sola columna CC; false = MOD y CIP separadas (B07). */
  conversionUnified: boolean;
  /** Período (para la clave de trazabilidad de los datos del cuadro). */
  periodId: string;

  units: ProcessDepartmentUnits;
  /** Grado de avance de la EF en MP (fracción). Default 1 (MP al inicio). */
  finalWipMpAvance?: number;
  /** Grado de avance de la EF en conversión (fracción). Default 0. */
  finalWipConversionAvance?: number;

  costs: ProcessElementCosts;
  /**
   * Costo TOTAL del departamento anterior arrastrado en la existencia inicial
   * (B09, solo seq > 1). Desde B18 lo persiste
   * `UnitMovementSchedule.initialWipCostPrevDept` y lo carga la apertura del
   * período siguiente; en un departamento inicial, o en el primer período de la
   * estructura, no hay nada que arrastrar. Default 0.
   */
  initialWipTransferredCost?: number;

  jointAllocation?: ProcessJointAllocationInput;
}

export interface ProcessCalculationInput {
  /** Departamentos de la estructura. El motor los ordena por `sequence`. */
  departments: ProcessDepartmentInput[];
}

/** Cuadro de movimiento serializado (números) para el resultado persistido. */
export interface ProcessScheduleResult {
  initialWip: number;
  startedInProduction: number;
  receivedFromPrevious: number;
  unitIncrease: number;
  periodUnits: number;
  transferredOut: number;
  finishedInStock: number;
  normalLoss: number;
  extraordinaryLoss: number;
  finalWip: number;
  totalToAccount: number;
  totalAccounted: number;
}

export interface ProcessEquivalentColumnResult {
  element: string;
  label: string;
  finalWipAvance: number;
  equivalentUnits: number;
}

export interface ProcessTransferredCostResult {
  costoModificado: number;
  caup: number;
  costoTransferido: number;
  unidadesAJustificar: number;
  unidadesBuenas: number;
  costoDeLaPerdida: number;
  step1Applied: boolean;
  step2Applied: boolean;
}

export interface ProcessReportElementResult {
  element: string;
  label: string;
  costoInventarioInicial: number;
  costoDelPeriodo: number;
  costoTotal: number;
  produccionProcesada: number;
  costoUnitario: number;
  unidadesEquivalentesEF: number;
  valuacionEF: number;
}

export interface ProcessReportResult {
  sequence: number;
  previousDepartment?: {
    costoUnitarioTransferido: number;
    costoTotal: number;
    unidadesEF: number;
    valuacionEF: number;
  };
  elements: ProcessReportElementResult[];
  costoUnitarioTotalAcumulado: number;
  costoAcumuladoAJustificar: number;
  costoTerminadasYTransferidas: number;
  costoTerminadasEnStock: number;
  costoPerdidasExtraordinarias: number;
  costoExistenciaFinalPorDiferencia: number;
  totalJustificado: number;
  valuacionExistenciaFinalPorElemento: number;
  ajustePorRedondeo: number;
}

export interface ProcessJointCostResult {
  method: JointAllocationMethod;
  jointCostTotal: number;
  totalAllocated: number;
  lines: Array<{
    productName: string;
    unitsObtained: number;
    allocationBase: number;
    participationPct: number;
    allocatedCost: number;
    unitCost: number;
  }>;
}

export interface ProcessDepartmentResult {
  id: string;
  name: string;
  sequence: number;
  conversionUnified: boolean;
  schedule: ProcessScheduleResult;
  equivalentProduction: {
    unitsAtFullCompletion: number;
    columns: ProcessEquivalentColumnResult[];
  };
  transferredCost?: ProcessTransferredCostResult;
  report: ProcessReportResult;
  jointCost?: ProcessJointCostResult;
}

export interface ProcessCalculationOutput {
  departments: ProcessDepartmentResult[];
  /** Costo unitario total acumulado del ÚLTIMO departamento = costo del producto terminado. */
  finalUnitCost: number;
  /** Nombre del último departamento (para mostrar sin exponer ids). */
  finalDepartmentName: string;
}

/** Lo que el departamento N lleva hacia adelante, hacia N+1. */
interface CarryForward {
  unitCost: Decimal;
  transferredOutUnits: Decimal;
  transferredOutCost: Decimal;
}

export class ProcessCostingEngine
  implements CostingEngine<ProcessCalculationInput, ProcessCalculationOutput>
{
  readonly engineVersion = PROCESS_ENGINE_VERSION;

  run(input: ProcessCalculationInput): CostingResult<ProcessCalculationOutput> {
    if (input.departments.length === 0) {
      throw new ProcessValidationError(
        'La estructura de Costeo por Procesos no tiene departamentos cargados. Agregá al menos un departamento antes de calcular.',
        { field: 'departments' },
      );
    }

    // Recorrido EN ORDEN DE SECUENCIA (no confiar en el orden de llegada).
    const departments = [...input.departments].sort((a, b) => a.sequence - b.sequence);

    const results: ProcessDepartmentResult[] = [];
    const tree: TreeNode[] = [];
    let previous: CarryForward | undefined;

    for (const dept of departments) {
      const { result, root, carry } = this.runDepartment(dept, previous);
      results.push(result);
      tree.push(root);
      previous = carry;
    }

    const lastDept = results[results.length - 1]!;
    const output: ProcessCalculationOutput = {
      departments: results,
      finalUnitCost: lastDept.report.costoUnitarioTotalAcumulado,
      finalDepartmentName: lastDept.name,
    };

    return { results: output, tree };
  }

  /** Corre las 5 etapas de un departamento y arma su rama del árbol. */
  private runDepartment(
    dept: ProcessDepartmentInput,
    previous: CarryForward | undefined,
  ): { result: ProcessDepartmentResult; root: TreeNode; carry: CarryForward } {
    // a. Cuadro de movimiento de unidades (B06) — incluye las pérdidas (B08).
    const schedule = buildUnitMovementSchedule({ sequence: dept.sequence, ...dept.units });

    // b. Producción equivalente (B07).
    const pe = this.equivalentProduction(dept, schedule);

    // d. Costo transferido del anterior (B09) — solo seq > 1.
    let transferred: TransferredCost | undefined;
    let previousDepartmentCost: PreviousDepartmentCostInput | undefined;
    if (dept.sequence > 1) {
      if (!previous) {
        throw new ProcessValidationError(
          `El departamento «${dept.name}» (secuencia ${dept.sequence}) no tiene un departamento anterior en la cadena. ` +
            'Revisá que las secuencias arranquen en 1 y sean consecutivas.',
          { field: 'sequence' },
        );
      }
      transferred = calcTransferredCost({
        sequence: dept.sequence,
        previousUnitCost: previous.unitCost,
        initialWipTransferredCost: dept.initialWipTransferredCost ?? 0,
        initialWipUnits: schedule.initialWip,
        // "Costo del anterior del período" = unidades recibidas × costo unitario previo.
        previousPeriodTransferredCost: schedule.receivedFromPrevious.times(previous.unitCost),
        receivedUnits: schedule.receivedFromPrevious,
        unitIncrease: schedule.unitIncrease,
        normalLossUnits: schedule.normalLoss,
      });
      previousDepartmentCost = {
        costoUnitarioTransferido: transferred.costoTransferido,
        // Sección A: unidades buenas × costo transferido (semántica del CAUP, B10).
        costoTotal: transferred.unidadesBuenas.times(transferred.costoTransferido),
      };
    }

    // e. Informe de costos de producción (B10) — con la doble verificación de EF.
    const elementCosts = this.elementCosts(dept);
    const report = buildProductionCostReport({
      sequence: dept.sequence,
      schedule,
      equivalentProduction: pe,
      elementCosts,
      previousDepartmentCost,
    });

    // Costos conjuntos (B11/B16) si el departamento es punto de separación.
    let joint: JointCostAllocationResult | undefined;
    if (dept.jointAllocation) {
      try {
        joint = allocateJointCosts(
          dept.jointAllocation.products,
          dept.jointAllocation.method,
          dept.jointAllocation.jointCostTotal,
        );
      } catch (e) {
        throw this.nameDepartment(e, dept.name);
      }
    }

    const result: ProcessDepartmentResult = {
      id: dept.id,
      name: dept.name,
      sequence: dept.sequence,
      conversionUnified: dept.conversionUnified,
      schedule: this.serializeSchedule(schedule),
      equivalentProduction: {
        unitsAtFullCompletion: pe.unitsAtFullCompletion.toNumber(),
        columns: pe.columns.map((c) => ({
          element: c.element,
          label: c.label,
          finalWipAvance: c.finalWipAvance.toNumber(),
          equivalentUnits: c.equivalentUnits.toNumber(),
        })),
      },
      transferredCost: transferred ? this.serializeTransferred(transferred) : undefined,
      report: this.serializeReport(report),
      jointCost: joint ? this.serializeJoint(joint) : undefined,
    };

    const root = this.buildDepartmentTree(dept, schedule, report, transferred, joint);

    const carry: CarryForward = {
      unitCost: report.costoUnitarioTotalAcumulado,
      transferredOutUnits: schedule.transferredOut,
      transferredOutCost: report.costoTerminadasYTransferidas,
    };

    return { result, root, carry };
  }

  /** Producción equivalente según el modo de conversión del departamento. */
  private equivalentProduction(
    dept: ProcessDepartmentInput,
    schedule: UnitMovementSchedule,
  ): EquivalentProductionSchedule {
    const mpAvance = dept.finalWipMpAvance ?? 1;
    const convAvance = dept.finalWipConversionAvance ?? 0;
    const peInput: EquivalentProductionInput = dept.conversionUnified
      ? { schedule, mpAvance, conversionUnified: true, conversionAvance: convAvance }
      : { schedule, mpAvance, conversionUnified: false, modAvance: convAvance, cipAvance: convAvance };
    try {
      return calcEquivalentProduction(peInput);
    } catch (e) {
      throw this.nameDepartment(e, dept.name);
    }
  }

  /**
   * Mapea los costos MP/MO/CIF del departamento a las columnas de la producción
   * equivalente: MP siempre, y luego CC (MO + CIF combinados) si la conversión va
   * unificada, o MOD y CIP separados si no. El orden respeta el de la PE.
   */
  private elementCosts(dept: ProcessDepartmentInput): ProductionCostElementCost[] {
    const c = dept.costs;
    const mp: ProductionCostElementCost = {
      element: 'MP',
      costoInventarioInicial: c.mpInicial ?? 0,
      costoDelPeriodo: c.mpPeriodo ?? 0,
    };
    if (dept.conversionUnified) {
      return [
        mp,
        {
          element: 'CC',
          costoInventarioInicial: (c.moInicial ?? 0) + (c.cifInicial ?? 0),
          costoDelPeriodo: (c.moPeriodo ?? 0) + (c.cifPeriodo ?? 0),
        },
      ];
    }
    return [
      mp,
      { element: 'MOD', costoInventarioInicial: c.moInicial ?? 0, costoDelPeriodo: c.moPeriodo ?? 0 },
      { element: 'CIP', costoInventarioInicial: c.cifInicial ?? 0, costoDelPeriodo: c.cifPeriodo ?? 0 },
    ];
  }

  // --------------------------------------------------------------------------
  // Árbol de derivación — UNA RAÍZ POR DEPARTAMENTO
  // --------------------------------------------------------------------------

  /**
   * Arma la rama del árbol de un departamento: una raíz por departamento
   * ("Departamento 1º — Destilado") con sub-nodos por MP / conversión / costo
   * transferido / CAUP, la justificación del costo y —como hojas— los datos del
   * cuadro que se cargaron a mano, con su `traceFieldKey` para que el servicio
   * los enlace a su `DataPoint` (drill-down del frontend hasta el origen).
   */
  private buildDepartmentTree(
    dept: ProcessDepartmentInput,
    schedule: UnitMovementSchedule,
    report: ProductionCostReport,
    transferred: TransferredCost | undefined,
    joint: JointCostAllocationResult | undefined,
  ): TreeNode {
    const children: TreeNode[] = [];

    // Costo transferido del anterior + su apertura (costo modificado + CAUP).
    if (transferred && report.previousDepartment) {
      children.push({
        label: 'Costo del departamento anterior',
        formula: 'costo modificado + CAUP',
        value: report.previousDepartment.costoUnitarioTransferido.toNumber(),
        unit: '$/u',
        children: [
          {
            label: 'Costo modificado',
            formula: '(costo EI del anterior + costo del anterior del período) ÷ unidades a justificar',
            value: transferred.costoModificado.toNumber(),
            unit: '$/u',
            children: [],
          },
          {
            label: 'CAUP — Costo Adicional por Unidades Perdidas',
            formula: 'costo de la pérdida ÷ unidades buenas',
            value: transferred.caup.toNumber(),
            unit: '$/u',
            children: [],
          },
        ],
      });
    }

    // Un sub-nodo por elemento del costo (MP / CC o MOD/CIP): costo unitario.
    for (const e of report.elements) {
      children.push({
        label: e.label,
        formula: 'costo total del elemento ÷ producción equivalente',
        value: e.costoUnitario.toNumber(),
        unit: '$/u',
        children: [
          { label: 'Costo total del elemento', value: e.costoTotal.toNumber(), unit: '$', children: [] },
          { label: 'Producción equivalente', value: e.produccionProcesada.toNumber(), unit: 'u', children: [] },
        ],
      });
    }

    // Justificación del costo (Parte 2 del informe).
    children.push({
      label: 'Terminadas y transferidas',
      formula: 'unidades terminadas y transferidas × costo unitario total acumulado',
      value: report.costoTerminadasYTransferidas.toNumber(),
      unit: '$',
      children: [],
    });
    if (report.costoTerminadasEnStock.gt(0)) {
      children.push({
        label: 'Terminadas en existencia',
        value: report.costoTerminadasEnStock.toNumber(),
        unit: '$',
        children: [],
      });
    }
    if (report.costoPerdidasExtraordinarias.gt(0)) {
      children.push({
        label: 'Pérdidas extraordinarias',
        formula: 'unidades extraordinarias × costo unitario total acumulado (va al Estado de Resultados)',
        value: report.costoPerdidasExtraordinarias.toNumber(),
        unit: '$',
        children: [],
      });
    }
    children.push({
      label: 'Existencia final en proceso',
      formula: 'costo acumulado a justificar − terminadas y transferidas − stock − extraordinarias',
      value: report.costoExistenciaFinalPorDiferencia.toNumber(),
      unit: '$',
      children: [],
    });

    // Reparto de costos conjuntos (si el departamento es punto de separación).
    if (joint) {
      children.push({
        label: 'Reparto de costos conjuntos',
        formula: `método ${joint.method}`,
        value: joint.jointCostTotal.toNumber(),
        unit: '$',
        children: joint.lines.map((l) => ({
          label: l.productName,
          formula: 'participación × costo conjunto total',
          value: l.allocatedCost.toNumber(),
          unit: '$',
          children: [
            { label: 'Costo unitario', value: l.unitCost.toNumber(), unit: '$/u', children: [] },
          ],
        })),
      });
    }

    // Hojas: los datos del cuadro que se cargaron a mano, enlazables a DataPoint.
    children.push(this.buildCuadroLeaves(dept, schedule));

    const ordinal = `${dept.sequence}º`;
    return {
      label: `Departamento ${ordinal} — ${dept.name}`,
      formula: 'costo unitario total acumulado del departamento',
      value: report.costoUnitarioTotalAcumulado.toNumber(),
      unit: '$/u',
      children,
    };
  }

  /**
   * Nodo "Cuadro de movimiento de unidades" con una hoja por cada dato del cuadro,
   * cada una con su `traceFieldKey` (misma clave que persiste `UnitMovementService`,
   * B15) para que el servicio la enlace a su `DataPoint`. El frontend drilla desde
   * la hoja hasta la ficha del dato origen.
   */
  private buildCuadroLeaves(dept: ProcessDepartmentInput, schedule: UnitMovementSchedule): TreeNode {
    const key = (field: string): string => `proceso.cuadro.${dept.periodId}.${dept.id}.${field}`;
    const leaf = (field: string, label: string, value: Decimal, unit: string): TreeNode => ({
      label,
      value: value.toNumber(),
      unit,
      children: [],
      traceFieldKey: key(field),
    });

    const leaves: TreeNode[] = [];
    if (dept.sequence === 1) {
      leaves.push(leaf('startedInProduction', 'Puestas en elaboración', schedule.startedInProduction, 'u'));
    } else {
      leaves.push(leaf('receivedFromPrevious', 'Recibidas del departamento anterior', schedule.receivedFromPrevious, 'u'));
      if (schedule.unitIncrease.gt(0)) {
        leaves.push(leaf('unitIncrease', 'Aumento de número de unidades', schedule.unitIncrease, 'u'));
      }
    }
    if (schedule.initialWip.gt(0)) {
      leaves.push(leaf('initialWip', 'Existencia inicial en proceso', schedule.initialWip, 'u'));
    }
    leaves.push(leaf('transferredOut', 'Terminadas y transferidas', schedule.transferredOut, 'u'));
    if (schedule.finishedInStock.gt(0)) {
      leaves.push(leaf('finishedInStock', 'Terminadas en existencia', schedule.finishedInStock, 'u'));
    }
    if (schedule.normalLoss.gt(0)) {
      leaves.push(leaf('totalLossReported', 'Pérdida real total del período', schedule.normalLoss.plus(schedule.extraordinaryLoss), 'u'));
    }
    leaves.push(leaf('finalWip', 'Existencia final en proceso', schedule.finalWip, 'u'));

    return {
      label: 'Cuadro de movimiento de unidades',
      formula: 'unidades a justificar = unidades justificadas',
      value: schedule.totalToAccount.toNumber(),
      unit: 'u',
      children: leaves,
    };
  }

  // --------------------------------------------------------------------------
  // Serialización a números (para persistir `results` como JSON)
  // --------------------------------------------------------------------------

  private serializeSchedule(s: UnitMovementSchedule): ProcessScheduleResult {
    return {
      initialWip: s.initialWip.toNumber(),
      startedInProduction: s.startedInProduction.toNumber(),
      receivedFromPrevious: s.receivedFromPrevious.toNumber(),
      unitIncrease: s.unitIncrease.toNumber(),
      periodUnits: s.periodUnits.toNumber(),
      transferredOut: s.transferredOut.toNumber(),
      finishedInStock: s.finishedInStock.toNumber(),
      normalLoss: s.normalLoss.toNumber(),
      extraordinaryLoss: s.extraordinaryLoss.toNumber(),
      finalWip: s.finalWip.toNumber(),
      totalToAccount: s.totalToAccount.toNumber(),
      totalAccounted: s.totalAccounted.toNumber(),
    };
  }

  private serializeTransferred(t: TransferredCost): ProcessTransferredCostResult {
    return {
      costoModificado: t.costoModificado.toNumber(),
      caup: t.caup.toNumber(),
      costoTransferido: t.costoTransferido.toNumber(),
      unidadesAJustificar: t.unidadesAJustificar.toNumber(),
      unidadesBuenas: t.unidadesBuenas.toNumber(),
      costoDeLaPerdida: t.costoDeLaPerdida.toNumber(),
      step1Applied: t.step1Applied,
      step2Applied: t.step2Applied,
    };
  }

  private serializeReport(r: ProductionCostReport): ProcessReportResult {
    return {
      sequence: r.sequence,
      previousDepartment: r.previousDepartment
        ? {
            costoUnitarioTransferido: r.previousDepartment.costoUnitarioTransferido.toNumber(),
            costoTotal: r.previousDepartment.costoTotal.toNumber(),
            unidadesEF: r.previousDepartment.unidadesEF.toNumber(),
            valuacionEF: r.previousDepartment.valuacionEF.toNumber(),
          }
        : undefined,
      elements: r.elements.map((e) => ({
        element: e.element,
        label: e.label,
        costoInventarioInicial: e.costoInventarioInicial.toNumber(),
        costoDelPeriodo: e.costoDelPeriodo.toNumber(),
        costoTotal: e.costoTotal.toNumber(),
        produccionProcesada: e.produccionProcesada.toNumber(),
        costoUnitario: e.costoUnitario.toNumber(),
        unidadesEquivalentesEF: e.unidadesEquivalentesEF.toNumber(),
        valuacionEF: e.valuacionEF.toNumber(),
      })),
      costoUnitarioTotalAcumulado: r.costoUnitarioTotalAcumulado.toNumber(),
      costoAcumuladoAJustificar: r.costoAcumuladoAJustificar.toNumber(),
      costoTerminadasYTransferidas: r.costoTerminadasYTransferidas.toNumber(),
      costoTerminadasEnStock: r.costoTerminadasEnStock.toNumber(),
      costoPerdidasExtraordinarias: r.costoPerdidasExtraordinarias.toNumber(),
      costoExistenciaFinalPorDiferencia: r.costoExistenciaFinalPorDiferencia.toNumber(),
      totalJustificado: r.totalJustificado.toNumber(),
      valuacionExistenciaFinalPorElemento: r.valuacionExistenciaFinalPorElemento.toNumber(),
      ajustePorRedondeo: r.ajustePorRedondeo.toNumber(),
    };
  }

  private serializeJoint(j: JointCostAllocationResult): ProcessJointCostResult {
    return {
      method: j.method,
      jointCostTotal: j.jointCostTotal.toNumber(),
      totalAllocated: j.totalAllocated.toNumber(),
      lines: j.lines.map((l) => ({
        productName: l.productName,
        unitsObtained: l.unitsObtained.toNumber(),
        allocationBase: l.allocationBase.toNumber(),
        participationPct: l.participationPct.toNumber(),
        allocatedCost: l.allocatedCost.toNumber(),
        unitCost: l.unitCost.toNumber(),
      })),
    };
  }

  /** Antepone el nombre del departamento al mensaje del dominio (regla: nunca un id). */
  private nameDepartment(e: unknown, name: string): unknown {
    if (e instanceof ProcessValidationError) {
      return new ProcessValidationError(
        `Departamento «${name}»: ${e.message}`,
        e.details as Record<string, unknown> | undefined,
      );
    }
    return e;
  }
}
