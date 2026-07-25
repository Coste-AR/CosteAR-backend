import type { Prisma } from '@prisma/client';
import { recordTraceAudit, type TraceActor } from '../audit/trace-audit.js';
import { type TreeNode } from './tree-builder.js';

/**
 * PERSISTENCIA COMPARTIDA DE UNA CORRIDA DE CÁLCULO (CalculationRun + CalculationNode).
 *
 * Una sola definición de "cómo se guarda una corrida y su árbol de derivación",
 * reutilizada por TODOS los motores de costeo (Órdenes hoy, Procesos con B17).
 * Antes vivía inline en `calculation-run-service.ts`; se extrajo tal cual —sin
 * cambiar una query— para que el motor de Procesos NO escriba una segunda copia
 * de la persistencia (regla del refactor: una fuente de verdad para el árbol).
 *
 * `results` e `inputsSnapshot` se guardan como JSON: cada motor tiene su propia
 * forma de resultado (Órdenes: `CalculationOutput`; Procesos: el informe por
 * departamento) y la tabla no se casa con ninguna.
 */

export interface PersistCalculationRunParams {
  structureId: string;
  /** Versión del motor con el que se calculó (para leer una corrida vieja). */
  engineVersion: string;
  /** Usuario que ejecutó la corrida (server-side, del JWT). */
  executedBy: string;
  /** Snapshot de los insumos ya resueltos (JSON). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inputsSnapshot: any;
  /** Resultado consolidado del motor (JSON). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  results: any;
  /** Árbol de derivación a persistir en `calculation_nodes`. */
  tree: TreeNode[];
  /** Auditoría de la corrida: quién y el resumen (`runId`/`runN` se agregan acá). */
  audit: {
    actor: TraceActor;
    /** Campos extra del `after` (p. ej. `grossMargin` en Órdenes). Se le suma `runId`/`runN`. */
    after: Record<string, unknown>;
  };
}

/**
 * Guarda UNA corrida y su árbol dentro de una transacción ya abierta (la del
 * `withTenant` del servicio que la invoca, para que quede en la misma unidad
 * atómica y con el tenant seteado para RLS). Devuelve el run creado y su `runN`.
 *
 * El `runN` es el siguiente correlativo de la estructura (append-only: nunca se
 * pisa una corrida anterior). La auditoría se registra en la MISMA transacción
 * (regla dura: AUDIT en la misma tx).
 */
export async function persistCalculationRun(
  tx: Prisma.TransactionClient,
  params: PersistCalculationRunParams,
): Promise<{ run: { id: string; runN: number }; runN: number }> {
  const last = await tx.calculationRun.findFirst({
    where: { structureId: params.structureId },
    orderBy: { runN: 'desc' },
  });
  const runN = (last?.runN ?? 0) + 1;

  const run = await tx.calculationRun.create({
    data: {
      structureId: params.structureId,
      runN,
      engineVersion: params.engineVersion,
      executedBy: params.executedBy,
      inputsSnapshot: params.inputsSnapshot,
      results: params.results,
    },
  });

  await persistTree(tx, run.id, params.tree, null);

  await recordTraceAudit(
    {
      entityType: 'CostStructure',
      entityId: params.structureId,
      action: 'calcular',
      actor: params.audit.actor,
      after: { runId: run.id, runN, ...params.audit.after },
    },
    tx,
  );

  return { run, runN };
}

/**
 * Persiste el árbol de derivación en `calculation_nodes` (recursivo, con `ord`
 * por nivel). El `sourceDataPointId` de un nodo (si el servicio lo anotó) se
 * guarda en `sourceDpVersionIds` para que el frontend haga drill-down hasta la
 * ficha del dato origen.
 */
export async function persistTree(
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
