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
 *
 * CONCURRENCIA — por qué hay un lock explícito acá
 * ------------------------------------------------
 * Asignar `runN` es un read-then-write: se lee el máximo actual y se escribe el
 * siguiente. Sin lock, dos corridas simultáneas sobre la MISMA estructura leen
 * las dos `runN = N`, las dos intentan escribir `N + 1`, y la segunda choca
 * contra `@@unique([structureId, runN])`. No es un error recuperable: revienta
 * la transacción entera, y como la auditoría va en la misma tx (regla del repo),
 * se pierde también el rastro de que se intentó calcular.
 *
 * Hoy no se manifiesta porque solo calcula el costista, de a una. Se va a
 * manifestar en cuanto exista el cálculo diario automático corriendo en paralelo
 * con el botón de "calcular" — que es justo lo que se viene.
 *
 * El `FOR UPDATE` toma el lock de la fila de ESA estructura hasta que la
 * transacción commitea, serializando sus corridas. No bloquea a otras
 * estructuras: dos empresas distintas calculan en paralelo sin verse.
 *
 * Se eligió el lock por sobre un reintento ante el error de unicidad porque el
 * reintento tapa el síntoma: deja pasar la carrera y espera que la segunda vuelta
 * tenga suerte. Y por sobre una secuencia de Postgres porque `runN` tiene que ser
 * correlativo POR ESTRUCTURA (una secuencia global dejaría huecos, y el número de
 * corrida es visible para el costista).
 */
export async function persistCalculationRun(
  tx: Prisma.TransactionClient,
  params: PersistCalculationRunParams,
): Promise<{ run: { id: string; runN: number }; runN: number }> {
  // Lock de la fila de la estructura. Tiene que ir ANTES de leer el máximo:
  // si va después, la lectura ya ocurrió y la carrera está perdida.
  await tx.$queryRaw`SELECT id FROM cost_structures WHERE id = ${params.structureId}::uuid FOR UPDATE`;

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
