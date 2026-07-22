import type { PrismaClient, Prisma } from '@prisma/client';
import { prisma, withTenant } from '../../infrastructure/database/prisma.js';
import { recordTraceAudit, type TraceActor } from '../audit/trace-audit.js';
import { NotFoundError } from '../../domain/errors/domain-error.js';
import { MissingInputError } from '../../domain/errors/calculation-errors.js';
import {
  rawMaterialSectionSchema,
  directLaborConfigSchema,
  indirectCostConfigSchema,
  inventorySchema,
} from '../../shared/schemas/cost.schema.js';
import { runCalculation, ENGINE_VERSION, type CalculationInput } from '../../domain/calculations/calculate.js';
import { buildCalculationTree, type TreeNode } from './tree-builder.js';
import { validateCalculationInputs, toMissingInputError } from './validate-inputs.js';

/**
 * Marca de incompletitud de una corrida (F04). Contrato ADITIVO que consume el
 * frontend para decidir si pinta una advertencia en vez de un margen "sano".
 *
 * Se persiste dentro de `CalculationRun.results.incompletitud` (JSON, no rompe a
 * ningún consumidor que ya lee `results.grossMargin`, etc.) y se devuelve además
 * como `incompleto` en el nivel superior de la respuesta.
 *
 * Regla #7: `motivos` no lleva endpoints ni identificadores internos. El `id` de
 * cada dato pendiente es SOLO para que el front abra su ficha; lo que se muestra
 * es el `nombre` humano.
 */
export interface Incompletitud {
  /** true si el cálculo corrió con datos sin decisión de imputación de período. */
  incompleto: boolean;
  /** Motivos legibles para el costista (español, sin endpoints ni ids). */
  motivos: string[];
  /** Datos que faltan imputar: `id` para navegar a la ficha, `nombre` para mostrar. */
  datosPendientes: { id: string; nombre: string }[];
}

/**
 * Arma la marca de incompletitud a partir de los datos sin imputar. Sin datos
 * pendientes, `incompleto: false` (el resultado es confiable).
 */
function buildIncompletitud(pending: { id: string; label: string }[]): Incompletitud {
  if (pending.length === 0) {
    return { incompleto: false, motivos: [], datosPendientes: [] };
  }
  const datosPendientes = pending.map((d) => ({ id: d.id, nombre: d.label }));
  const nombres = datosPendientes.map((d) => `"${d.nombre}"`).join(', ');
  const motivos = [
    `Hay ${pending.length} dato(s) sin decisión de imputación de período (${nombres}). ` +
      'El costo puede estar dejándolos afuera o mezclando datos de otro mes, así que este ' +
      'resultado todavía no es confiable. Resolvé la imputación desde la ficha de cada dato ' +
      'antes de dar el costo por bueno.',
  ];
  return { incompleto: true, motivos, datosPendientes };
}

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

    // Doble período (spec D.3): un dato sin decisión de imputación no se puede
    // asignar con certeza a este mes. F04 — decisión: el cálculo NO se bloquea
    // (bloquearlo sin una pantalla para imputar dejaría al costista sin acción
    // posible). Corre igual, pero el resultado se MARCA como incompleto/no
    // confiable, con el motivo y los datos afectados por su nombre humano, para
    // que el frontend muestre una advertencia en vez de un margen "sano". El
    // bloqueo duro se mueve al CIERRE del período (acción irreversible) —
    // ver `CostPeriodService.close` y DECISIONES.md.
    // Nota: `take: 20` acota nombres y payload; con >20 pendientes el conteo del
    // motivo queda en 20 (mismo tope que la detección original).
    const pending = await this.db.dataPoint.findMany({
      where: { structureId, periodoImputado: null, voidedAt: null, status: { not: 'anulado' } },
      select: { id: true, label: true },
      take: 20,
    });
    const incompletitud = buildIncompletitud(pending);

    const input: CalculationInput = {
      rawMaterial: rawMaterialSectionSchema.parse(s.rawMaterialConfig),
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

    // Enriquecimiento de trazabilidad (D.1/D.2): no toca ningún valor
    // calculado, solo anota qué DataPoint respalda cada nodo, para que el
    // frontend pueda ofrecer "click en la hoja → ficha del dato". Matchea
    // por fieldKey en las 4 raíces (mp.config/mod.config/cip.config/
    // venta.config, los bloques que crea `db:backfill-trazabilidad`) y por
    // label exacto en el resto del árbol (cubre p.ej. los movimientos de MP
    // "Compra — X" / "Consumo — X" creados vía POST /data-points cuando
    // tienen el mismo label que ya arma `tree-builder.ts`).
    await this.attachDataPointSources(structureId, tree);

    // La marca de incompletitud viaja DENTRO de `results` (persistida con la
    // corrida) y también suelta en la respuesta. Es aditiva: `results` sigue
    // teniendo `grossMargin`, `grossMarginPct`, etc. tal cual.
    const results = { ...output, incompletitud };

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
          results: results as any,
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

      return { run, results, tree, incompletitud };
    });
  }

  private static readonly ROOT_FIELD_KEYS = ['mp.config', 'mod.config', 'cip.config', 'venta.config'];

  private async attachDataPointSources(structureId: string, tree: TreeNode[]): Promise<void> {
    const existing = await this.db.dataPoint.findMany({
      where: { structureId, voidedAt: null },
      select: { id: true, label: true, fieldKey: true },
    });
    if (existing.length === 0) return;

    const byFieldKey = new Map(existing.map((d) => [d.fieldKey, d.id]));
    const byLabel = new Map(existing.map((d) => [d.label, d.id]));

    tree.forEach((root, i) => {
      const fieldKey = CalculationRunService.ROOT_FIELD_KEYS[i];
      const dpId = fieldKey ? byFieldKey.get(fieldKey) : undefined;
      if (dpId) root.sourceDataPointId = dpId;
    });

    const walk = (nodes: TreeNode[]) => {
      for (const node of nodes) {
        const dpId = byLabel.get(node.label);
        if (dpId) node.sourceDataPointId = dpId;
        if (node.children.length > 0) walk(node.children);
      }
    };
    walk(tree);
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
        sourceDpVersionIds: node.sourceDataPointId ? [node.sourceDataPointId] : [],
      },
    });
    if (node.children.length > 0) {
      await persistTree(tx, runId, node.children, created.id);
    }
  }
}
