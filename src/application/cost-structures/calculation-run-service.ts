import type { PrismaClient, Prisma } from '@prisma/client';
import { prisma, withTenant } from '../../infrastructure/database/prisma.js';
import { recordTraceAudit, type TraceActor } from '../audit/trace-audit.js';
import { NotFoundError } from '../../domain/errors/domain-error.js';
import { MissingInputError } from '../../domain/errors/calculation-errors.js';
import {
  rawMaterialConfigSchema,
  directLaborConfigSchema,
  indirectCostConfigSchema,
  inventorySchema,
} from '../../shared/schemas/cost.schema.js';
import { runCalculation, ENGINE_VERSION, type CalculationInput } from './calculate.js';
import { buildCalculationTree, type TreeNode } from './tree-builder.js';
import { validateCalculationInputs, toMissingInputError } from './validate-inputs.js';

/**
 * Corridas del motor con árbol persistido (spec sección B + C). Reemplaza,
 * para los endpoints NUEVOS de trazabilidad, al `CostCalculation` legado
 * (que se mantiene intacto para `/cost-structures/:id/calculate` — ver
 * DECISIONES.md). Cada `calculate()` es UNA transacción: resolver config →
 * validar insumos → correr motor → persistir run + árbol → auditar.
 */
export class CalculationRunService {
  constructor(private readonly db: PrismaClient = prisma) {}

  private async requireStructure(userId: string, structureId: string) {
    const s = await this.db.costStructure.findFirst({ where: { id: structureId, userId } });
    if (!s) throw new NotFoundError('Estructura de costos no encontrada');
    return s;
  }

  async calculate(userId: string, structureId: string, actor: TraceActor) {
    const s = await this.requireStructure(userId, structureId);

    if (!s.rawMaterialConfig) {
      throw new MissingInputError('rawMaterial', 'Falta cargar la sección de Materia Prima antes de calcular.');
    }
    if (!s.directLaborConfig) {
      throw new MissingInputError('directLabor', 'Falta cargar la sección de Mano de Obra Directa antes de calcular.');
    }
    if (!s.indirectCostConfig) {
      throw new MissingInputError('indirectCosts', 'Falta cargar la sección de Costos Indirectos antes de calcular.');
    }

    // Doble período (spec D.3): un dato sin decisión de imputación queda
    // pendiente y el cálculo NO puede correr hasta que se decida a qué
    // período pertenece — evita que un dato de otro mes se cuele sin que
    // nadie lo haya decidido explícitamente.
    const pending = await this.db.dataPoint.findMany({
      where: { structureId, periodoImputado: null, voidedAt: null, status: { not: 'anulado' } },
      select: { id: true, label: true },
      take: 20,
    });
    if (pending.length > 0) {
      throw new MissingInputError(
        'periodoImputado',
        `Hay ${pending.length} dato(s) sin decisión de imputación de período (ej. "${pending[0]!.label}") — ` +
          'resolvé con POST /data-points/:id/imputacion antes de calcular.',
      );
    }

    const input: CalculationInput = {
      rawMaterial: rawMaterialConfigSchema.parse(s.rawMaterialConfig),
      directLabor: directLaborConfigSchema.parse(s.directLaborConfig),
      indirectCosts: indirectCostConfigSchema.parse(s.indirectCostConfig),
      inventory: inventorySchema.parse({}),
      sales: {
        unitPrice: s.salesUnitPrice ? Number(s.salesUnitPrice) : 0,
        quantity: s.salesQuantity ? Number(s.salesQuantity) : 0,
      },
    };

    // Fix crítico (B): insumo faltante → 422 accionable, nunca 500.
    // Corre siempre (idempotente) al calcular, sin depender de que el cierre
    // del prorrateo secundario ya haya corrido al guardar CIF.
    validateCalculationInputs(input);

    let output;
    let tree: TreeNode[];
    try {
      output = runCalculation(input);
      tree = buildCalculationTree(input, output);
    } catch (err) {
      if (err instanceof MissingInputError) throw err;
      throw toMissingInputError(err);
    }

    return withTenant(userId, async (tx) => {
      const last = await tx.calculationRun.findFirst({
        where: { structureId },
        orderBy: { runN: 'desc' },
      });
      const runN = (last?.runN ?? 0) + 1;

      const run = await tx.calculationRun.create({
        data: {
          structureId,
          runN,
          engineVersion: ENGINE_VERSION,
          executedBy: actor.id,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          inputsSnapshot: input as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          results: output as any,
        },
      });

      await persistTree(tx, run.id, tree, null);

      await recordTraceAudit(
        {
          entityType: 'CostStructure',
          entityId: structureId,
          action: 'calcular',
          actor,
          after: { runId: run.id, runN, grossMargin: output.grossMargin, grossMarginPct: output.grossMarginPct },
        },
        tx,
      );

      return { run, results: output, tree };
    });
  }

  async getTree(userId: string, runId: string) {
    const run = await this.db.calculationRun.findFirst({
      where: { id: runId, structure: { userId } },
    });
    if (!run) throw new NotFoundError('Corrida de cálculo no encontrada');

    const nodes = await this.db.calculationNode.findMany({
      where: { runId },
      orderBy: [{ parentId: 'asc' }, { ord: 'asc' }],
    });

    const byParent = new Map<string | null, typeof nodes>();
    for (const n of nodes) {
      const key = n.parentId ?? '__root__';
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key)!.push(n);
    }

    function toTree(parentId: string | null): unknown[] {
      const key = parentId ?? '__root__';
      return (byParent.get(key) ?? [])
        .sort((a, b) => a.ord - b.ord)
        .map((n) => ({
          id: n.id,
          label: n.label,
          formula: n.formula,
          value: n.valueNum !== null ? Number(n.valueNum) : null,
          unit: n.unit,
          sourceDpVersionIds: n.sourceDpVersionIds,
          children: toTree(n.id),
        }));
    }

    return { runId: run.id, runN: run.runN, engineVersion: run.engineVersion, tree: toTree(null) };
  }

  async listRuns(userId: string, structureId: string) {
    await this.requireStructure(userId, structureId);
    const runs = await this.db.calculationRun.findMany({
      where: { structureId },
      orderBy: { runN: 'desc' },
      include: { executedByUser: true },
      take: 100,
    });
    return runs.map((r) => {
      const results = r.results as { grossMargin?: number; grossMarginPct?: number };
      return {
        id: r.id,
        runN: r.runN,
        engineVersion: r.engineVersion,
        executedBy: r.executedByUser.name,
        executedAt: r.executedAt.toISOString(),
        grossMargin: results.grossMargin ?? null,
        grossMarginPct: results.grossMarginPct ?? null,
      };
    });
  }
}

async function persistTree(
  tx: Prisma.TransactionClient,
  runId: string,
  nodes: TreeNode[],
  parentId: string | null,
): Promise<void> {
  let ord = 0;
  for (const node of nodes) {
    const created = await tx.calculationNode.create({
      data: {
        runId,
        parentId,
        ord: ord++,
        label: node.label,
        formula: node.formula,
        valueNum: node.value,
        unit: node.unit,
      },
    });
    if (node.children.length > 0) {
      await persistTree(tx, runId, node.children, created.id);
    }
  }
}
