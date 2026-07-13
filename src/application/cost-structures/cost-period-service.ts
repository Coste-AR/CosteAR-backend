import type { PrismaClient, Prisma } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma.js';
import { recordAudit, type AuditContext } from '../audit/audit-logger.js';
import { NotFoundError, ValidationError } from '../../domain/errors/domain-error.js';
import {
  periodBounds,
  nextPeriodCode,
  normalizeLegacyCode,
  type Periodicity,
} from '../../domain/periods/period-calendar.js';

/**
 * PERÍODOS DE COSTEO (problema C — Fase 1).
 *
 * Un período es el MES (o quincena, o trimestre) costeado: dueño de sus datos y
 * de su resultado. Tres operaciones:
 *
 *   ABRIR   — nace el período siguiente, copiando del anterior lo que el
 *             costista elija (la receta siempre; los importes, opcional).
 *   CERRAR  — congela el período. NO se puede cerrar si algún centro productivo
 *             no tiene la actividad real y el CIP real cargados (E3): el cierre
 *             es el momento en que el sistema exige los datos que faltan.
 *   REABRIR — se permite (siempre aparece una factura tarde), pero exige un
 *             MOTIVO y deja rastro: quién, cuándo y por qué.
 *
 * Regla dura: una estructura tiene como máximo UN período abierto a la vez.
 */

/** Qué se arrastra del período anterior al abrir el nuevo. */
export interface CarryOverOptions {
  /** Centros, bases, departamentos, capacidad normal. Siempre viene: es el molde. */
  recipe?: true;
  /** Importes de CIF y sueldos del período anterior, para revisar y corregir. */
  amounts?: boolean;
}

interface ProductiveSetting {
  centerId?: string;
  actualActivity?: number;
  actualCip?: number;
  [k: string]: unknown;
}

export class CostPeriodService {
  constructor(private readonly db: PrismaClient = prisma) {}

  private async requireStructure(userId: string, structureId: string) {
    const s = await this.db.costStructure.findFirst({
      where: { id: structureId, userId, deletedAt: null },
      include: { company: true },
    });
    if (!s) throw new NotFoundError('Estructura de costos no encontrada');
    return s;
  }

  private async requirePeriod(userId: string, periodId: string) {
    const p = await this.db.costPeriod.findFirst({ where: { id: periodId, userId } });
    if (!p) throw new NotFoundError('Período no encontrado');
    return p;
  }

  /** Períodos de una estructura, del más nuevo al más viejo. */
  async list(userId: string, structureId: string) {
    await this.requireStructure(userId, structureId);
    return this.db.costPeriod.findMany({
      where: { structureId },
      orderBy: { code: 'desc' },
    });
  }

  /** El período en el que se está trabajando (a lo sumo uno). */
  async getOpen(userId: string, structureId: string) {
    await this.requireStructure(userId, structureId);
    return this.db.costPeriod.findFirst({
      where: { structureId, status: 'OPEN' },
      orderBy: { code: 'desc' },
    });
  }

  /**
   * Abre el período SIGUIENTE al último. Si no hay ninguno todavía, abre el que
   * corresponde al `period` histórico de la estructura.
   */
  async openNext(
    userId: string,
    structureId: string,
    carry: CarryOverOptions,
    ctx: AuditContext,
  ) {
    const structure = await this.requireStructure(userId, structureId);
    const periodicity = structure.company.periodicity as Periodicity;

    const open = await this.db.costPeriod.findFirst({ where: { structureId, status: 'OPEN' } });
    if (open) {
      throw new ValidationError(
        `No se puede abrir un período nuevo: "${open.label}" sigue abierto. Cerralo primero.`,
      );
    }

    const last = await this.db.costPeriod.findFirst({
      where: { structureId },
      orderBy: { code: 'desc' },
    });

    const code = last
      ? nextPeriodCode(normalizeLegacyCode(last.code, periodicity), periodicity)
      : normalizeLegacyCode(structure.period, periodicity);

    const bounds = periodBounds(code, periodicity);

    const created = await this.db.costPeriod.create({
      data: {
        structureId,
        companyId: structure.companyId,
        userId,
        code: bounds.code,
        label: bounds.label,
        startDate: bounds.startDate,
        endDate: bounds.endDate,
        status: 'OPEN',
        ...this.carryOver(last, carry),
      },
    });

    await recordAudit({
      ...ctx,
      userId,
      action: 'cost_period.open',
      entityType: 'CostPeriod',
      entityId: created.id,
      newValue: { code: created.code, carry },
    });

    return created;
  }

  /**
   * Qué datos arrastra el período nuevo desde el anterior.
   *
   *   · La RECETA (centros, bases, departamentos, capacidad normal) siempre.
   *   · Los IMPORTES (CIF y sueldos), solo si el costista lo pidió.
   *   · Lo que es del mes — compras, consumos, actividad real, CIP real — NUNCA:
   *     arrastrarlo sería costear julio con los movimientos de junio.
   */
  private carryOver(
    last: {
      rawMaterialConfig: Prisma.JsonValue;
      directLaborConfig: Prisma.JsonValue;
      indirectCostConfig: Prisma.JsonValue;
    } | null,
    carry: CarryOverOptions,
  ): Record<string, unknown> {
    if (!last) return {};

    const clone = <T>(v: T): T => (v == null ? v : JSON.parse(JSON.stringify(v)));

    // ── Materia prima: la ficha del insumo sí, los movimientos del mes no.
    const rm = clone(last.rawMaterialConfig) as { materials?: Record<string, unknown>[] } | null;
    if (rm && Array.isArray(rm.materials)) {
      for (const m of rm.materials) {
        m.movements = []; // compras y consumos son del mes que arranca
      }
    }

    // ── Mano de obra: la estructura de departamentos y el ITCS. Los importes
    //    (sueldos básicos) solo si se pidió arrastrarlos.
    const dl = clone(last.directLaborConfig) as
      | { departments?: { basicRemuneration?: number }[] }
      | null;
    if (dl && Array.isArray(dl.departments) && !carry.amounts) {
      for (const d of dl.departments) d.basicRemuneration = 0;
    }

    // ── CIF: centros, bases y capacidad normal siempre. Importes, opcional.
    //    Actividad real y CIP real NUNCA (son el cierre del mes anterior).
    const ic = clone(last.indirectCostConfig) as
      | {
          concepts?: { amount?: { fixed?: number; variable?: number } }[];
          productiveSettings?: ProductiveSetting[];
        }
      | null;
    if (ic) {
      if (Array.isArray(ic.concepts) && !carry.amounts) {
        for (const c of ic.concepts) c.amount = { fixed: 0, variable: 0 };
      }
      if (Array.isArray(ic.productiveSettings)) {
        for (const ps of ic.productiveSettings) {
          ps.actualActivity = 0;
          ps.actualCip = 0;
        }
      }
    }

    return {
      rawMaterialConfig: rm ?? undefined,
      directLaborConfig: dl ?? undefined,
      indirectCostConfig: ic ?? undefined,
    };
  }

  /**
   * Cierra el período: congela los números.
   *
   * Requisito duro (E3): todo centro productivo debe tener actividad real y CIP
   * real cargados. Sin eso, el costo del período está calculado con presupuesto
   * y cerrarlo sería congelar una foto incompleta.
   */
  async close(userId: string, periodId: string, runId: string | null, ctx: AuditContext) {
    const period = await this.requirePeriod(userId, periodId);
    if (period.status === 'CLOSED') {
      throw new ValidationError(`El período "${period.label}" ya está cerrado.`);
    }

    const missing = this.centersMissingClosing(period.indirectCostConfig);
    if (missing.length > 0) {
      throw new ValidationError(
        `No se puede cerrar "${period.label}": ${missing.length} centro(s) productivo(s) sin el cierre cargado ` +
          `(actividad real y/o CIP real): ${missing.join(', ')}. Cargá esos datos antes de cerrar.`,
      );
    }

    const closed = await this.db.costPeriod.update({
      where: { id: periodId },
      data: {
        status: 'CLOSED',
        closedAt: new Date(),
        closedBy: userId,
        closedRunId: runId,
      },
    });

    await recordAudit({
      ...ctx,
      userId,
      action: 'cost_period.close',
      entityType: 'CostPeriod',
      entityId: periodId,
      newValue: { code: closed.code, closedRunId: runId },
    });

    return closed;
  }

  /** Centros productivos a los que les falta el cierre (misma regla que E3). */
  private centersMissingClosing(indirectCostConfig: unknown): string[] {
    const cfg = indirectCostConfig as
      | { centers?: { id: string; name: string; type: string }[]; productiveSettings?: ProductiveSetting[] }
      | null;
    if (!cfg?.productiveSettings?.length) return [];

    const nameById = new Map((cfg.centers ?? []).map((c) => [c.id, c.name]));
    const missing: string[] = [];
    for (const ps of cfg.productiveSettings) {
      const hasActivity = Number(ps.actualActivity ?? 0) > 0;
      const hasCip = Number(ps.actualCip ?? 0) > 0;
      if (!hasActivity || !hasCip) {
        missing.push(nameById.get(String(ps.centerId)) ?? String(ps.centerId));
      }
    }
    return missing;
  }

  /**
   * Reabre un período cerrado. Exige un motivo y deja rastro: es la excepción,
   * no la regla.
   */
  async reopen(userId: string, periodId: string, reason: string, ctx: AuditContext) {
    const period = await this.requirePeriod(userId, periodId);
    if (period.status !== 'CLOSED') {
      throw new ValidationError(`El período "${period.label}" no está cerrado.`);
    }
    const motivo = reason.trim();
    if (motivo.length < 10) {
      throw new ValidationError(
        'Para reabrir un período cerrado hay que explicar por qué (al menos 10 caracteres). Queda registrado.',
      );
    }

    const reopened = await this.db.costPeriod.update({
      where: { id: periodId },
      data: {
        status: 'OPEN',
        reopenedAt: new Date(),
        reopenReason: motivo,
        reopenCount: { increment: 1 },
      },
    });

    await recordAudit({
      ...ctx,
      userId,
      action: 'cost_period.reopen',
      entityType: 'CostPeriod',
      entityId: periodId,
      oldValue: { status: 'CLOSED', closedAt: period.closedAt },
      newValue: { status: 'OPEN', reason: motivo, reopenCount: reopened.reopenCount },
    });

    return reopened;
  }
}
