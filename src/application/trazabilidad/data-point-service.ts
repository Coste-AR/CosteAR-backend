import type { PrismaClient } from '@prisma/client';
import { prisma, withTenant } from '../../infrastructure/database/prisma.js';
import { recordTraceAudit, type TraceActor } from '../audit/trace-audit.js';
import { NotFoundError } from '../../domain/errors/domain-error.js';
import { fmtMoney, fmtNumber } from './format.js';
import type {
  CreateDataPointInput,
  AddVersionInput,
} from '../../shared/schemas/trazabilidad.schema.js';

/**
 * Servicio de Trazabilidad Total v1 (spec secciones A y C).
 *
 * Toda mutación corre dentro de una única transacción de DB (`withTenant`,
 * que además setea el tenant para RLS) y escribe su entrada en
 * `trace_audit_log` en esa misma transacción (R2). Ningún dato se pisa: las
 * correcciones siempre insertan una versión nueva (R1).
 */
export class DataPointService {
  constructor(private readonly db: PrismaClient = prisma) {}

  /** Confirma que el data point pertenece a una estructura del usuario. */
  async requireDataPoint(userId: string, id: string) {
    const dp = await this.db.dataPoint.findFirst({
      where: { id, structure: { userId } },
      include: { structure: true },
    });
    if (!dp) throw new NotFoundError('Dato no encontrado');
    return dp;
  }

  private async requireStructureOwned(userId: string, structureId: string) {
    const s = await this.db.costStructure.findFirst({ where: { id: structureId, userId } });
    if (!s) throw new NotFoundError('Estructura de costos no encontrada');
    return s;
  }

  /**
   * Crea un DataPoint + su versión 1. Es el único punto de entrada de un dato
   * nuevo al sistema de trazabilidad (no hay "versión 0" implícita).
   */
  async create(userId: string, structureId: string, input: CreateDataPointInput, actor: TraceActor) {
    await this.requireStructureOwned(userId, structureId);

    return withTenant(userId, async (tx) => {
      const dp = await tx.dataPoint.create({
        data: {
          structureId,
          element: input.element,
          fieldKey: input.fieldKey,
          label: input.label,
          unit: input.unit,
          sourceArea: input.sourceArea,
          fechaHecho: input.fechaHecho ? new Date(input.fechaHecho) : null,
        },
      });
      await tx.dataPointVersion.create({
        data: {
          dataPointId: dp.id,
          versionN: 1,
          valueNum: input.valueNum,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          valueJson: input.valueJson as any,
          reason: input.reason,
          evidenceId: input.evidenceId,
          method: input.method,
          createdBy: actor.id,
          actorRole: actor.role,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          actorArea: input.sourceArea as any,
          deviceInfo: input.deviceInfo ?? actor.device,
        },
      });
      await recordTraceAudit(
        {
          entityType: 'DataPoint',
          entityId: dp.id,
          action: 'crear',
          actor: { ...actor, area: input.sourceArea, method: input.method },
          after: { fieldKey: input.fieldKey, valueNum: input.valueNum, valueJson: input.valueJson },
        },
        tx,
      );
      return dp;
    });
  }

  /**
   * Agrega una corrección. NUNCA pisa la versión anterior: inserta version_n+1
   * con `reason` obligatorio. Si el dato ya estaba validado/aplicado, vuelve a
   * 'borrador' — una corrección invalida la firma anterior y pide re-validar.
   */
  async addVersion(userId: string, id: string, input: AddVersionInput, actor: TraceActor) {
    const dp = await this.requireDataPoint(userId, id);
    const last = await this.db.dataPointVersion.findFirst({
      where: { dataPointId: id },
      orderBy: { versionN: 'desc' },
    });
    const nextN = (last?.versionN ?? 0) + 1;

    return withTenant(userId, async (tx) => {
      const version = await tx.dataPointVersion.create({
        data: {
          dataPointId: id,
          versionN: nextN,
          valueNum: input.valueNum,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          valueJson: input.valueJson as any,
          reason: input.reason,
          evidenceId: input.evidenceId,
          method: input.method,
          createdBy: actor.id,
          actorRole: actor.role,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          actorArea: input.sourceArea as any,
          deviceInfo: input.deviceInfo ?? actor.device,
        },
      });
      // Una corrección invalida cualquier firma previa: vuelve a 'borrador'
      // aunque ya estuviera validado/aplicado (pide re-validar).
      const updated = await tx.dataPoint.update({
        where: { id },
        data: {
          status: 'borrador',
          fechaHecho: input.fechaHecho ? new Date(input.fechaHecho) : dp.fechaHecho,
        },
      });
      await recordTraceAudit(
        {
          entityType: 'DataPoint',
          entityId: id,
          action: 'versionar',
          actor: { ...actor, area: input.sourceArea, method: input.method },
          before: { versionN: last?.versionN ?? null, valueNum: last?.valueNum, valueJson: last?.valueJson },
          after: { versionN: nextN, valueNum: input.valueNum, valueJson: input.valueJson },
          comment: input.reason,
        },
        tx,
      );
      return { dataPoint: updated, version };
    });
  }

  /** borrador → validado. Firma: actor + hora exacta. */
  async validate(userId: string, id: string, sourceArea: string, actor: TraceActor) {
    const dp = await this.requireDataPoint(userId, id);
    if (dp.status === 'validado' || dp.status === 'aplicado') {
      return dp; // idempotente: ya estaba validado
    }

    return withTenant(userId, async (tx) => {
      const updated = await tx.dataPoint.update({ where: { id }, data: { status: 'validado' } });
      await recordTraceAudit(
        {
          entityType: 'DataPoint',
          entityId: id,
          action: 'validar',
          actor: { ...actor, area: sourceArea },
          before: { status: dp.status },
          after: { status: 'validado' },
        },
        tx,
      );
      return updated;
    });
  }

  /** "Pedir revisión": no cambia el estado, solo deja constancia auditable del pedido. */
  async requestRevision(userId: string, id: string, comment: string, sourceArea: string, actor: TraceActor) {
    await this.requireDataPoint(userId, id);
    return withTenant(userId, async (tx) => {
      await recordTraceAudit(
        {
          entityType: 'DataPoint',
          entityId: id,
          action: 'pedir_revision',
          actor: { ...actor, area: sourceArea },
          comment,
        },
        tx,
      );
    });
  }

  /**
   * Decisión de imputación (doble período, spec D.3). Un dato sin
   * `periodoImputado` queda pendiente y el motor de cálculo lo excluye.
   */
  async imputar(userId: string, id: string, periodo: string, sourceArea: string, actor: TraceActor) {
    const dp = await this.requireDataPoint(userId, id);
    return withTenant(userId, async (tx) => {
      const updated = await tx.dataPoint.update({
        where: { id },
        data: { periodoImputado: periodo },
      });
      await recordTraceAudit(
        {
          entityType: 'DataPoint',
          entityId: id,
          action: 'imputar',
          actor: { ...actor, area: sourceArea },
          before: { periodoImputado: dp.periodoImputado },
          after: { periodoImputado: periodo },
        },
        tx,
      );
      return updated;
    });
  }

  /** Anulado lógico (R1: nunca DELETE). */
  async void(userId: string, id: string, sourceArea: string, comment: string | undefined, actor: TraceActor) {
    const dp = await this.requireDataPoint(userId, id);
    if (dp.voidedAt) return dp;
    return withTenant(userId, async (tx) => {
      const updated = await tx.dataPoint.update({
        where: { id },
        data: { voidedAt: new Date(), status: 'anulado' },
      });
      await recordTraceAudit(
        {
          entityType: 'DataPoint',
          entityId: id,
          action: 'anular',
          actor: { ...actor, area: sourceArea },
          comment,
        },
        tx,
      );
      return updated;
    });
  }

  /**
   * Ficha completa de un dato (contrato exacto de la spec, sección C).
   *
   * Si el valor es parte de un movimiento compuesto (compra de MP: cantidad +
   * precio cargados por actores distintos, unidos por `valueJson.movementId`),
   * la ficha agrupa AMBOS data points hermanos en un solo `fields[]` — tal
   * como pide la nota de la spec ("la ficha los agrupa").
   */
  async getTrace(userId: string, id: string) {
    const dp = await this.requireDataPoint(userId, id);
    const versions = await this.db.dataPointVersion.findMany({
      where: { dataPointId: id },
      orderBy: { versionN: 'desc' },
      include: { createdByUser: true, evidence: true },
    });
    const current = versions[0] ?? null;

    // Siblings: mismo movementId dentro de la misma estructura, distinto data point.
    let siblingCurrents: Array<{
      role: string | undefined;
      version: (typeof versions)[number];
      dataPoint: { id: string; unit: string | null; label: string };
    }> = [];

    const movementId = (current?.valueJson as Record<string, unknown> | null)?.movementId as
      | string
      | undefined;

    if (movementId) {
      const siblings = await this.db.dataPoint.findMany({
        where: { structureId: dp.structureId, id: { not: id } },
        include: {
          versions: { orderBy: { versionN: 'desc' }, take: 1, include: { createdByUser: true } },
        },
      });
      for (const sib of siblings) {
        const v = sib.versions[0];
        if (!v) continue;
        const vJson = v.valueJson as Record<string, unknown> | null;
        if (vJson?.movementId === movementId) {
          siblingCurrents.push({
            role: vJson.role as string | undefined,
            version: v as (typeof versions)[number],
            dataPoint: { id: sib.id, unit: sib.unit, label: sib.label },
          });
        }
      }
    }

    const fields = this.buildFields(dp, current, siblingCurrents);
    const display = this.buildDisplay(fields);

    let signedBy: { name: string; role: string; at: string } | null = null;
    if (dp.status === 'validado' || dp.status === 'aplicado') {
      const validation = await this.db.traceAuditLog.findFirst({
        where: { entityType: 'DataPoint', entityId: id, action: 'validar' },
        orderBy: { at: 'desc' },
        include: { actor: true },
      });
      if (validation?.actor) {
        signedBy = { name: validation.actor.name, role: validation.actorRole, at: validation.at.toISOString() };
      }
    }

    return {
      id: dp.id,
      label: dp.label,
      display,
      status: dp.status,
      signedBy,
      fields,
      periods: {
        hecho: dp.fechaHecho ? dp.fechaHecho.toISOString().slice(0, 10) : null,
        captacion: dp.fechaCaptacion.toISOString(),
        imputado: dp.periodoImputado,
      },
      evidence: current?.evidence
        ? { kind: current.evidence.kind, reference: current.evidence.reference, fileUrl: current.evidence.fileUrl }
        : null,
      versions: versions.map((v) => ({
        n: v.versionN,
        current: v.versionN === current?.versionN,
        display: v.valueNum !== null ? fmtNumber(Number(v.valueNum)) : JSON.stringify(v.valueJson),
        reason: v.reason,
        by: v.createdByUser.name,
        at: v.createdAt.toISOString(),
      })),
      impacts: this.impactsFor(dp.element),
    };
  }

  private buildFields(
    dp: { unit: string | null; label: string },
    current: {
      valueNum: unknown;
      valueJson: unknown;
      method: string;
      actorRole: string;
      actorArea: string;
      deviceInfo: string | null;
      createdAt: Date;
      createdByUser: { name: string };
    } | null,
    siblings: Array<{
      role: string | undefined;
      version: {
        valueNum: unknown;
        method: string;
        actorRole: string;
        actorArea: string;
        deviceInfo: string | null;
        createdAt: Date;
        createdByUser: { name: string };
      };
      dataPoint: { unit: string | null; label: string };
    }>,
  ) {
    const out: Array<{
      key: string;
      value: number | null;
      unit: string | null;
      by: { name: string; role: string; area: string };
      at: string;
      method: string;
      device: string | null;
    }> = [];

    if (!current) return out;

    const selfJson = current.valueJson as Record<string, unknown> | null;
    const selfRole = (selfJson?.role as string) ?? this.defaultFieldKey(dp.label);
    out.push({
      key: selfRole,
      value: current.valueNum !== null && current.valueNum !== undefined ? Number(current.valueNum) : null,
      unit: dp.unit,
      by: { name: current.createdByUser.name, role: current.actorRole, area: current.actorArea },
      at: current.createdAt.toISOString(),
      method: current.method,
      device: current.deviceInfo,
    });

    for (const sib of siblings) {
      out.push({
        key: sib.role ?? sib.dataPoint.label,
        value: sib.version.valueNum !== null && sib.version.valueNum !== undefined ? Number(sib.version.valueNum) : null,
        unit: sib.dataPoint.unit,
        by: { name: sib.version.createdByUser.name, role: sib.version.actorRole, area: sib.version.actorArea },
        at: sib.version.createdAt.toISOString(),
        method: sib.version.method,
        device: sib.version.deviceInfo,
      });
    }

    return out;
  }

  private defaultFieldKey(label: string): string {
    return label.toLowerCase().includes('precio') ? 'precio' : 'valor';
  }

  private buildDisplay(
    fields: Array<{ key: string; value: number | null; unit: string | null }>,
  ): string {
    const cantidad = fields.find((f) => f.key === 'cantidad');
    const precio = fields.find((f) => f.key === 'precio');
    if (cantidad?.value != null && precio?.value != null) {
      const total = cantidad.value * precio.value;
      return `${fmtNumber(cantidad.value)} ${cantidad.unit ?? 'u'} × ${fmtMoney(precio.value)} = ${fmtMoney(total)}`;
    }
    const only = fields[0];
    if (!only || only.value == null) return '—';
    return only.unit === '$' ? fmtMoney(only.value) : `${fmtNumber(only.value)} ${only.unit ?? ''}`.trim();
  }

  private impactsFor(element: string): string[] {
    switch (element) {
      case 'MP':
        return ['PPP', 'MP consumida', 'Costo de producción', 'COGS', 'Margen'];
      case 'MOD':
        return ['ITCS', 'MOD total', 'Costo de producción', 'COGS', 'Margen'];
      case 'CIP':
        return ['CIP aplicado', 'Costo de producción', 'COGS', 'Margen'];
      case 'VENTA':
        return ['Ingreso', 'Margen', 'Margen %'];
      default:
        return [];
    }
  }

  /** Bitácora paginada de una estructura (todas sus acciones de trazabilidad). */
  async getAudit(userId: string, structureId: string, page: number, pageSize: number) {
    await this.requireStructureOwned(userId, structureId);
    const dpIds = (
      await this.db.dataPoint.findMany({ where: { structureId }, select: { id: true } })
    ).map((d) => d.id);
    const runIds = (
      await this.db.calculationRun.findMany({ where: { structureId }, select: { id: true } })
    ).map((r) => r.id);

    const entityIds = [structureId, ...dpIds, ...runIds];
    const [total, entries] = await Promise.all([
      this.db.traceAuditLog.count({ where: { entityId: { in: entityIds } } }),
      this.db.traceAuditLog.findMany({
        where: { entityId: { in: entityIds } },
        orderBy: { at: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { actor: true },
      }),
    ]);

    return {
      page,
      pageSize,
      total,
      items: entries.map((e) => ({
        id: e.id.toString(),
        entityType: e.entityType,
        entityId: e.entityId,
        action: e.action,
        actor: e.actor ? { name: e.actor.name, role: e.actorRole, area: e.actorArea } : { name: 'Sistema', role: e.actorRole, area: e.actorArea },
        method: e.method,
        comment: e.comment,
        at: e.at.toISOString(),
      })),
    };
  }
}
