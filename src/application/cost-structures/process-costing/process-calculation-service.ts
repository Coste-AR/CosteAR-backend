import type { PrismaClient, Prisma } from '@prisma/client';
import { prisma, withTenant } from '../../../infrastructure/database/prisma.js';
import { type TraceActor } from '../../audit/trace-audit.js';
import { NotFoundError, UnprocessableEntityError, DomainError } from '../../../domain/errors/domain-error.js';
import { selectCostingEngine } from '../costing-engine.js';
import { persistCalculationRun } from '../calculation-run-persistence.js';
import { buildIncompletitud } from '../calculation-run-service.js';
import type { TreeNode } from '../tree-builder.js';
import type {
  ProcessCalculationInput,
  ProcessCalculationOutput,
  ProcessDepartmentInput,
} from './process-costing-engine.js';
import type { JointAllocationMethod } from '../../../domain/calculations/joint-costs.js';

/**
 * COSTEO POR PROCESOS · SERVICIO DE CÁLCULO (B17) — orquesta el motor con la DB.
 *
 * Es el borde de aplicación del `ProcessCostingEngine`: resuelve la estructura
 * (tenant + que sea de Procesos) y el período, carga los cuadros de movimiento y
 * los repartos de costos conjuntos de cada departamento, arma el insumo del motor
 * (función PURA), lo corre, marca la incompletitud (F04, idéntico a Órdenes) y
 * persiste la corrida + el árbol con la MISMA persistencia compartida que Órdenes
 * (`persistCalculationRun`) — no una segunda copia. Todo en una transacción
 * atómica y auditada.
 *
 * Nunca devuelve un 500 crudo: las inconsistencias de datos salen como 422
 * accionable en castellano (regla dura), sin exponer ids ni rutas internas.
 */

interface ProcessContext {
  structure: { id: string; productName: string };
  period: { id: string; label: string };
  engineInput: ProcessCalculationInput;
}

export class ProcessCalculationService {
  constructor(private readonly db: PrismaClient = prisma) {}

  /**
   * Corre el motor de Procesos sobre un (estructura, período) y PERSISTE la
   * corrida + su árbol de derivación. Devuelve el resultado con la marca de
   * incompletitud (F04) para que el frontend decida si pinta una advertencia.
   */
  async calculate(userId: string, structureId: string, periodId: string, actor: TraceActor) {
    const ctx = await this.buildEngineInput(userId, structureId, periodId);

    const engine = selectCostingEngine('PROCESSES');
    let output: ProcessCalculationOutput;
    let tree: TreeNode[];
    try {
      ({ results: output, tree } = engine.run(ctx.engineInput));
    } catch (err) {
      throw this.toActionable(err);
    }

    // Incompletitud (F04): datos sin decisión de imputación ⇒ el resultado se
    // marca como no confiable, igual que en Órdenes. Reutiliza el mismo armador.
    const pending = await this.db.dataPoint.findMany({
      where: { structureId, periodoImputado: null, voidedAt: null, status: { not: 'anulado' } },
      select: { id: true, label: true },
      take: 20,
    });
    const incompletitud = buildIncompletitud(pending);

    // Trazabilidad de las hojas del cuadro: enlaza cada hoja a su `DataPoint` por
    // la `traceFieldKey` que dejó el motor (drill-down del frontend al origen).
    await this.attachDataPointSources(structureId, tree);

    const results = { ...output, incompletitud };

    return withTenant(userId, async (tx) => {
      const { run } = await persistCalculationRun(tx, {
        structureId,
        engineVersion: engine.engineVersion,
        executedBy: actor.id,
        inputsSnapshot: { periodId, departments: ctx.engineInput.departments },
        results,
        tree,
        audit: {
          actor,
          after: {
            periodId,
            finalUnitCost: output.finalUnitCost,
            finalDepartmentName: output.finalDepartmentName,
          },
        },
      });

      return {
        run,
        period: ctx.period.label,
        results,
        tree,
        incompletitud,
      };
    });
  }

  /**
   * Informe de costos de producción de un (estructura, período) para mostrar/
   * exportar. Recalcula con el motor PURO (no persiste): devuelve el informe por
   * departamento tal como lo produce el motor.
   */
  async getProductionReport(userId: string, structureId: string, periodId: string) {
    const ctx = await this.buildEngineInput(userId, structureId, periodId);
    const engine = selectCostingEngine('PROCESSES');
    let output: ProcessCalculationOutput;
    try {
      ({ results: output } = engine.run(ctx.engineInput));
    } catch (err) {
      throw this.toActionable(err);
    }
    return {
      product: ctx.structure.productName,
      period: ctx.period.label,
      finalUnitCost: output.finalUnitCost,
      finalDepartmentName: output.finalDepartmentName,
      departments: output.departments,
    };
  }

  // --------------------------------------------------------------------------
  // Internos
  // --------------------------------------------------------------------------

  /**
   * Resuelve estructura + período + departamentos y arma el insumo del motor.
   * Compartido por `calculate` (persiste) y `getProductionReport` (solo lee), así
   * ambos ven exactamente los mismos números.
   */
  private async buildEngineInput(
    userId: string,
    structureId: string,
    periodId: string,
  ): Promise<ProcessContext> {
    const structure = await this.db.costStructure.findFirst({ where: { id: structureId, userId } });
    if (!structure) throw new NotFoundError('Estructura de costos no encontrada');
    if (structure.costingSystem !== 'PROCESSES') {
      throw new UnprocessableEntityError(
        `La estructura «${structure.productName}» usa Costeo por Órdenes; este cálculo es solo para estructuras de Costeo por Procesos.`,
      );
    }

    const period = await this.db.costPeriod.findFirst({ where: { id: periodId, structureId } });
    if (!period) throw new NotFoundError('Período de costos no encontrado');

    const departments = await this.db.processDepartment.findMany({
      where: { structureId, deletedAt: null },
      orderBy: { sequence: 'asc' },
    });
    if (departments.length === 0) {
      throw new UnprocessableEntityError(
        `La estructura «${structure.productName}» no tiene departamentos de proceso cargados. ` +
          'Agregá al menos un departamento antes de calcular.',
      );
    }

    const engineDepartments: ProcessDepartmentInput[] = [];
    for (const dept of departments) {
      const schedule = await this.db.unitMovementSchedule.findUnique({
        where: { departmentId_periodId: { departmentId: dept.id, periodId } },
      });
      if (!schedule) {
        throw new UnprocessableEntityError(
          `Falta el cuadro de movimiento de unidades del departamento «${dept.name}» para el período «${period.label}». ` +
            'Cargalo antes de calcular el costo por procesos.',
        );
      }

      const joint = await this.db.jointCostAllocation.findUnique({
        where: { departmentId_periodId: { departmentId: dept.id, periodId } },
        include: { products: true },
      });

      engineDepartments.push(this.toDepartmentInput(dept, schedule, joint, periodId));
    }

    return {
      structure: { id: structure.id, productName: structure.productName },
      period: { id: period.id, label: period.label },
      engineInput: { departments: engineDepartments },
    };
  }

  /** Mapea una fila persistida (departamento + cuadro + reparto) al insumo del motor. */
  private toDepartmentInput(
    dept: { id: string; name: string; sequence: number; defaultConversionAvanceEqualsMO: boolean },
    schedule: Record<string, unknown>,
    joint: { method: JointAllocationMethod; jointCostTotal: Prisma.Decimal | number; products: Array<Record<string, unknown>> } | null,
    periodId: string,
  ): ProcessDepartmentInput {
    const n = (x: unknown): number | undefined => (x == null ? undefined : Number(x));
    return {
      id: dept.id,
      name: dept.name,
      sequence: dept.sequence,
      conversionUnified: dept.defaultConversionAvanceEqualsMO,
      periodId,
      units: {
        initialWip: n(schedule.initialWip),
        startedInProduction: n(schedule.startedInProduction),
        receivedFromPrevious: n(schedule.receivedFromPrevious),
        unitIncrease: n(schedule.unitIncrease),
        transferredOut: n(schedule.transferredOut),
        finishedInStock: n(schedule.finishedInStock),
        normalLossPct: n(schedule.normalLossPct),
        totalLossReported: n(schedule.totalLossReported),
        finalWip: n(schedule.finalWip),
      },
      finalWipMpAvance: n(schedule.finalWipMpAvance),
      finalWipConversionAvance: n(schedule.finalWipConvAvance),
      costs: {
        mpInicial: n(schedule.initialWipCostMp),
        mpPeriodo: n(schedule.periodCostMp),
        moInicial: n(schedule.initialWipCostMo),
        moPeriodo: n(schedule.periodCostMo),
        cifInicial: n(schedule.initialWipCostCif),
        cifPeriodo: n(schedule.periodCostCif),
      },
      // Costo del departamento anterior que la EI ya traía adentro (costo
      // modificado + CAUP de la etapa previa). Lo persiste el arrastre entre
      // períodos (B18); en un departamento inicial o en el primer período de la
      // estructura no hay nada que arrastrar y queda en 0.
      initialWipTransferredCost: n(schedule.initialWipCostPrevDept) ?? 0,
      jointAllocation: joint
        ? {
            method: joint.method,
            jointCostTotal: Number(joint.jointCostTotal),
            products: joint.products.map((p) => ({
              productName: String(p.productName),
              unitsObtained: Number(p.unitsObtained),
              yieldPct: n(p.yieldPct),
              marketPrice: n(p.marketPrice),
              sellingCostVarPct: n(p.sellingCostVarPct),
              sellingCostFixedPerUnit: n(p.sellingCostFixedPerUnit),
            })),
          }
        : undefined,
    };
  }

  /**
   * Enlaza las hojas del árbol a sus `DataPoint` por `traceFieldKey` (una query).
   * Solo las cifras realmente cargadas a mano tienen DataPoint; las derivadas
   * quedan sin enlace (su `traceFieldKey` no resuelve, y no pasa nada).
   */
  private async attachDataPointSources(structureId: string, tree: TreeNode[]): Promise<void> {
    const keys = new Set<string>();
    const collect = (nodes: TreeNode[]) => {
      for (const node of nodes) {
        if (node.traceFieldKey) keys.add(node.traceFieldKey);
        if (node.children.length > 0) collect(node.children);
      }
    };
    collect(tree);
    if (keys.size === 0) return;

    const dps = await this.db.dataPoint.findMany({
      where: { structureId, fieldKey: { in: [...keys] }, voidedAt: null },
      select: { id: true, fieldKey: true },
    });
    if (dps.length === 0) return;
    const byKey = new Map(dps.map((d) => [d.fieldKey, d.id]));

    const attach = (nodes: TreeNode[]) => {
      for (const node of nodes) {
        if (node.traceFieldKey) {
          const dpId = byKey.get(node.traceFieldKey);
          if (dpId) node.sourceDataPointId = dpId;
        }
        if (node.children.length > 0) attach(node.children);
      }
    };
    attach(tree);
  }

  /** Cualquier error de dominio pasa tal cual (ya es 422/404); lo inesperado, a 422 accionable. */
  private toActionable(err: unknown): unknown {
    if (err instanceof DomainError) return err;
    return new UnprocessableEntityError(
      'No se pudo calcular el costo por procesos con los datos cargados. Revisá los cuadros de movimiento y los costos de cada departamento.',
    );
  }
}
