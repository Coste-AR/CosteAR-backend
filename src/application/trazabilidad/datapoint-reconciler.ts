import type { Prisma } from '@prisma/client';
import type { TraceActor } from '../audit/trace-audit.js';
import { DataPointService } from './data-point-service.js';
import type { CaptureMethod } from '../../shared/schemas/trazabilidad.schema.js';
import {
  LEGACY_BLOCK_FIELD_KEYS,
  MP_MOVEMENT_FIELD_KEYS,
  SECTION_PREFIX,
  movementIdentity,
  type DesiredPoint,
  type OrdersSection,
} from './orders-input-points.js';

/**
 * RECONCILIACIÓN DE DATA POINTS DE COSTEO POR ÓRDENES.
 *
 * El sistema promete que todo número en pantalla se puede abrir hasta el dato
 * que le dio origen. Esa promesa se cumple SOLO si el `DataPoint` es la forma
 * canónica de guardar un insumo — no un extra que registra el formulario de MP
 * cuando se acuerda. Hasta acá, un movimiento cargado por Excel, por la API o
 * por la ingesta de comprobantes quedaba huérfano PARA SIEMPRE: ni siquiera
 * volver a guardar la sección lo reparaba.
 *
 * Esta función corre DENTRO de la transacción del guardado de la sección, justo
 * después de persistir el JSON, y deja los data points en línea con la config:
 *
 *   · insumo sin data point            → se CREA (versión 1)
 *   · insumo con data point, valor nuevo → se agrega una VERSIÓN (jamás UPDATE:
 *                                          el trigger `data_point_versions_append_only`
 *                                          lo rechaza a nivel de motor)
 *   · insumo con data point, mismo valor → nada (guardar dos veces no versiona)
 *   · insumo que desapareció de la config → se ANULA lógicamente (`voidedAt`),
 *                                          nunca DELETE
 *
 * REPARACIÓN DE HUÉRFANOS (§6 del manual, "no inventar autores"). Un insumo que
 * ya estaba en la config ANTERIOR con el mismo valor y no tiene data point es un
 * dato pre-trazabilidad: no sabemos quién lo cargó. Se crea con el mismo rótulo
 * que usa `scripts/backfill-trazabilidad.mjs` — motivo 'migración: dato
 * pre-trazabilidad', rol 'desconocido (migrado)', método 'manual' — en vez de
 * atribuírselo a quien apretó Guardar hoy.
 *
 * Toda mutación deja su rastro en `trace_audit_log` en ESTA misma transacción:
 * lo hace `DataPointService`, que es el único lugar del sistema donde nace o
 * cambia un dato trazable (R2).
 */

/** Motivo de un dato que existía antes de que existiera la trazabilidad. */
export const MIGRATION_REASON = 'migración: dato pre-trazabilidad';

/**
 * Rol del autor de un dato migrado. NO es el rol de quien guardó: es la
 * declaración explícita de que no se sabe quién lo cargó.
 *
 * Mismo literal que `scripts/backfill-trazabilidad.mjs` (que corre con `node`
 * sobre el repo sin compilar y por eso no puede importar este módulo). Si
 * cambia acá, cambiarlo allá.
 */
export const MIGRATED_ACTOR_ROLE = 'desconocido (migrado)';

export interface ReconcileResult {
  creados: number;
  reparados: number;
  versionados: number;
  anulados: number;
}

interface ExistingPoint {
  id: string;
  fieldKey: string;
  label: string;
  fechaHecho: Date | null;
  versions: { valueNum: Prisma.Decimal | null; valueJson: Prisma.JsonValue | null }[];
}

/** Rol de un dato de movimiento (cantidad / precio) según lo guardado. */
function roleOf(dp: ExistingPoint): string {
  const json = dp.versions[0]?.valueJson as Record<string, unknown> | null | undefined;
  const role = json?.role;
  if (typeof role === 'string') return role;
  return dp.fieldKey.endsWith('.precio') ? 'precio' : 'cantidad';
}

function nextOccurrence(counter: Map<string, number>, base: string): number {
  const n = counter.get(base) ?? 0;
  counter.set(base, n + 1);
  return n;
}

export async function reconcileSectionDataPoints(
  tx: Prisma.TransactionClient,
  params: {
    structureId: string;
    section: OrdersSection;
    /** Insumos que la config NUEVA declara. */
    desired: DesiredPoint[];
    /** Insumos que declaraba la config ANTERIOR (para detectar huérfanos). */
    previous: DesiredPoint[];
    actor: TraceActor;
    /** Cómo entró el dato en este guardado ('manual', 'excel_import', ...). */
    method: CaptureMethod;
    /** Motivo de la versión nueva cuando el valor cambió. */
    reason: string;
    dataPoints?: DataPointService;
  },
): Promise<ReconcileResult> {
  const service = params.dataPoints ?? new DataPointService();
  const prefix = SECTION_PREFIX[params.section];
  const result: ReconcileResult = { creados: 0, reparados: 0, versionados: 0, anulados: 0 };

  const existing = (await tx.dataPoint.findMany({
    where: {
      structureId: params.structureId,
      voidedAt: null,
      fieldKey: { startsWith: prefix, notIn: LEGACY_BLOCK_FIELD_KEYS },
    },
    include: { versions: { orderBy: { versionN: 'desc' }, take: 1 } },
    orderBy: { createdAt: 'asc' },
  })) as unknown as ExistingPoint[];

  // Índice por identidad + índice de `movementId` ya asignados, para que un
  // precio creado hoy quede hermanado con la cantidad que ya existía (la ficha
  // los agrupa por `valueJson.movementId`).
  const byIdentity = new Map<string, ExistingPoint>();
  const movementIdByGroup = new Map<string, string>();
  const counter = new Map<string, number>();

  for (const dp of existing) {
    if (!MP_MOVEMENT_FIELD_KEYS.includes(dp.fieldKey)) {
      byIdentity.set(dp.fieldKey, dp);
      continue;
    }
    const role = roleOf(dp);
    const iso = dp.fechaHecho ? dp.fechaHecho.toISOString().slice(0, 10) : null;
    const occ = nextOccurrence(counter, `${dp.fieldKey}|${dp.label}|${iso ?? ''}|${role}`);
    byIdentity.set(movementIdentity(dp.fieldKey, dp.label, iso, role, occ), dp);

    const json = dp.versions[0]?.valueJson as Record<string, unknown> | null | undefined;
    const movementId = json?.movementId;
    const group = `${dp.label}|${iso ?? ''}|${occ}`;
    if (typeof movementId === 'string' && !movementIdByGroup.has(group)) {
      movementIdByGroup.set(group, movementId);
    }
  }

  // Un insumo es HUÉRFANO PRE-EXISTENTE si ya estaba en la config anterior con
  // el mismo valor: no lo cargó quien está guardando ahora.
  const previousValues = new Map(params.previous.map((d) => [d.identity, d.valueNum]));

  for (const want of params.desired) {
    const found = byIdentity.get(want.identity);
    byIdentity.delete(want.identity); // lo que sobre al final se anula

    if (found) {
      const last = found.versions[0]?.valueNum;
      // Sin cambio de valor no se versiona: guardar dos veces la misma sección
      // no puede ensuciar el historial.
      if (last != null && Number(last) === want.valueNum) continue;

      await service.addVersionInTx(
        tx,
        found.id,
        { fechaHecho: found.fechaHecho },
        {
          sourceArea: want.sourceArea,
          method: want.method ?? params.method,
          valueNum: want.valueNum,
          valueJson: valueJsonFor(want, movementIdByGroup),
          reason: params.reason,
          ...(want.fechaHecho ? { fechaHecho: want.fechaHecho } : {}),
        },
        params.actor,
      );
      result.versionados++;
      continue;
    }

    const esReparacion = previousValues.get(want.identity) === want.valueNum;
    await service.createInTx(
      tx,
      params.structureId,
      {
        element: want.element,
        fieldKey: want.fieldKey,
        label: want.label,
        ...(want.unit ? { unit: want.unit } : {}),
        sourceArea: want.sourceArea,
        method: esReparacion ? 'manual' : (want.method ?? params.method),
        valueNum: want.valueNum,
        valueJson: valueJsonFor(want, movementIdByGroup),
        reason: esReparacion ? MIGRATION_REASON : params.reason,
        ...(want.fechaHecho ? { fechaHecho: want.fechaHecho } : {}),
        ...(want.periodoImputado ? { periodoImputado: want.periodoImputado } : {}),
      },
      esReparacion ? { ...params.actor, role: MIGRATED_ACTOR_ROLE } : params.actor,
    );
    if (esReparacion) result.reparados++;
    else result.creados++;
  }

  // Lo que quedó en el índice ya no está en la config: se ANULA lógicamente.
  for (const orphan of byIdentity.values()) {
    await service.voidInTx(tx, orphan.id, params.actor, 'El dato ya no figura en la sección guardada');
    result.anulados++;
  }

  return result;
}

/**
 * `valueJson` del dato. En los movimientos lleva el `movementId` que hermana
 * cantidad y precio (reusando el que ya tenga el movimiento si existía) y el
 * `role`, que es lo que la ficha muestra como "cantidad × precio".
 */
function valueJsonFor(
  want: DesiredPoint,
  movementIdByGroup: Map<string, string>,
): Record<string, unknown> {
  const base = want.valueJson ?? {};
  if (!want.movementGroup) return base;
  const movementId = movementIdByGroup.get(want.movementGroup) ?? `mov:${want.movementGroup}`;
  return { ...base, movementId };
}
