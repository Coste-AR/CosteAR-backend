import type { PrismaClient, Prisma, CostPeriod } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma.js';
import { recordAudit, type AuditContext } from '../audit/audit-logger.js';
import { NotFoundError, ValidationError } from '../../domain/errors/domain-error.js';
import { MissingInputError } from '../../domain/errors/calculation-errors.js';
import {
  periodBounds,
  nextPeriodCode,
  normalizeLegacyCode,
  type Periodicity,
} from '../../domain/periods/period-calendar.js';
import {
  runCalculation,
  ENGINE_VERSION,
  type CalculationInput,
  type FrozenCalculation,
} from '../../domain/calculations/calculate.js';
import { type PeriodLike, type ProductiveSetting } from './cost-period-propagation-service.js';
import {
  rawMaterialSectionSchema,
  directLaborConfigSchema,
  indirectCostConfigSchema,
  inventorySchema,
} from '../../shared/schemas/cost.schema.js';
import { comparePeriods, type PeriodSide, type MacroContrast } from './period-comparison.js';
import { MacroService } from '../macro/macro-service.js';
/**
 * PERÍODOS DE COSTEO (problema C — Fases 1 y 3).
 *
 * Un período es el MES (o quincena, o trimestre) costeado: dueño de sus datos y
 * de su resultado. Tres operaciones:
 *
 *   ABRIR   — nace el período siguiente. Trae la receta del anterior, los
 *             importes solo si el costista los pide, y — Fase 3 — arrastra la
 *             EXISTENCIA FINAL de materia prima como existencia inicial,
 *             valuada al PPP con el que cerró. Lo que es del mes (compras,
 *             consumos, actividad real, CIP real) nunca viaja.
 *   CERRAR  — congela el período. NO se puede cerrar si algún centro productivo
 *             no tiene la actividad real y el CIP real cargados (E3): el cierre
 *             es el momento en que el sistema exige los datos que faltan.
 *   REABRIR — se permite (siempre aparece una factura tarde), pero exige un
 *             MOTIVO y deja rastro: quién, cuándo y por qué.
 *
 * Regla dura: una estructura tiene como máximo UN período abierto a la vez.
 *
 * Dónde viven los datos: la app sigue escribiendo en `cost_structures`, y cada
 * escritura se espeja en el período abierto (`period-sync.ts`). Por eso al abrir
 * el período siguiente hay que RESETEAR la estructura con lo que arrastra: es lo
 * que hace que la pantalla amanezca en el mes nuevo, sin las compras del anterior.
 * Nada se pierde: el mes que cerró quedó guardado en su período y en el historial
 * append-only de configs.
 */



export class CostPeriodService {
  constructor(
    private readonly db: PrismaClient = prisma,
    private readonly macro: MacroService = new MacroService(),
  ) {}

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
   * Cierra el período: congela los números.
   *
   * Requisito duro (E3): todo centro productivo debe tener actividad real y CIP
   * real cargados. Sin eso, el costo del período está calculado con presupuesto
   * y cerrarlo sería congelar una foto incompleta.
   *
   * Fase 4 — el cierre CORRE EL MOTOR y guarda el resultado (`resultSnapshot`).
   * Antes solo guardaba los insumos: los números había que recalcularlos después,
   * con el motor de ese momento, así que una mejora del motor podía cambiar un mes
   * ya cerrado sin que nadie se enterara. Un mes cerrado es un hecho contable: sus
   * números se leen, no se recalculan.
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

    // F04 — el cierre es la acción irreversible que consolida el mes: NUNCA
    // puede pasar sobre datos que todavía no se asignaron a un período. Mientras
    // el cálculo tolera datos sin imputar (los marca incompletos y sigue), el
    // cierre los BLOQUEA con un 422 accionable. Los datos cuelgan de la
    // estructura (no del período); un dato sin imputar podría pertenecer a este
    // mes, así que hasta resolverlo el cierre no es confiable.
    const unimputed = await this.db.dataPoint.findMany({
      where: {
        structureId: period.structureId,
        periodoImputado: null,
        voidedAt: null,
        status: { not: 'anulado' },
      },
      select: { id: true, label: true },
      take: 20,
    });
    if (unimputed.length > 0) {
      const nombres = unimputed.map((d) => `"${d.label}"`).join(', ');
      throw new MissingInputError(
        'periodoImputado',
        `No se puede cerrar "${period.label}": hay ${unimputed.length} dato(s) sin decisión de imputación ` +
          `de período (${nombres}). El cierre es definitivo, así que no puede hacerse sobre datos que ` +
          'todavía no se asignaron a un mes. Imputá cada dato desde su ficha (o anulalo si no corresponde) ' +
          'y volvé a cerrar.',
        // Lista estructurada para resolver EN EL LUGAR del bloqueo (F05): sin
        // esto el front cae a los pendientes del último cálculo, que puede estar
        // viejo (ej. datos ya imputados o recién agregados).
        unimputed.map((d) => ({ id: d.id, nombre: d.label })),
      );
    }

    // Si el motor no puede correr, el período NO se cierra: un mes cerrado sin
    // números es exactamente el agujero que esto viene a tapar.
    const frozen = this.computeResult(period, 'cerrar');

    const closed = await this.db.$transaction(async (tx) => {
      const updated = await tx.costPeriod.update({
        where: { id: periodId },
        data: {
          status: 'CLOSED',
          closedAt: new Date(),
          closedBy: userId,
          closedRunId: runId,
          resultSnapshot: frozen as unknown as Prisma.InputJsonValue,
          resultEngineVersion: ENGINE_VERSION,
          resultAt: new Date(),
        },
      });

      // R2: la mutación y su auditoría, en la MISMA transacción.
      await recordAudit(
        {
          ...ctx,
          userId,
          action: 'cost_period.close',
          entityType: 'CostPeriod',
          entityId: periodId,
          newValue: {
            code: updated.code,
            closedRunId: runId,
            engineVersion: ENGINE_VERSION,
            // Los números con los que quedó firmado el mes, en el registro de auditoría.
            productionCost: frozen.productionCost,
            costOfGoodsSold: frozen.costOfGoodsSold,
            grossMargin: frozen.grossMargin,
          },
        },
        tx,
      );

      // FASE 2: Detección Proactiva de Anomalías (Alertas Tempranas)
      const lastPeriods = await tx.costPeriod.findMany({
        where: { structureId: period.structureId, status: 'CLOSED', id: { not: periodId } },
        orderBy: { code: 'desc' },
        take: 3,
      });

      if (lastPeriods.length > 0) {
        let sumMP = 0;
        let sumMOD = 0;
        let validPeriodsCount = 0;

        for (const p of lastPeriods) {
          if (p.resultSnapshot) {
            const snap = p.resultSnapshot as any;
            sumMP += Number(snap.rawMaterialConsumed || 0);
            sumMOD += Number(snap.directLaborTotal || 0);
            validPeriodsCount++;
          }
        }

        if (validPeriodsCount > 0) {
          const avgMP = sumMP / validPeriodsCount;
          const avgMOD = sumMOD / validPeriodsCount;

          const currentMP = Number(frozen.rawMaterialConsumed || 0);
          const currentMOD = Number(frozen.directLaborTotal || 0);

          const devMP = avgMP > 0 ? (currentMP - avgMP) / avgMP : 0;
          const devMOD = avgMOD > 0 ? (currentMOD - avgMOD) / avgMOD : 0;

          if (devMP > 0.1) {
            await tx.alert.create({
              data: {
                userId,
                companyId: period.companyId,
                costStructureId: period.structureId,
                type: 'COST_SPIKE',
                message: `[Alerta de Anomalía: Materia Prima] El costo unitario de Materia Prima ($${currentMP.toFixed(2)}) subió un ${(devMP * 100).toFixed(1)}% respecto al promedio histórico ($${avgMP.toFixed(2)}). Te recomendamos revaluar el precio de venta sugerido en el Simulador de Escenarios.`,
              },
            });
          }

          if (devMOD > 0.1) {
            await tx.alert.create({
              data: {
                userId,
                companyId: period.companyId,
                costStructureId: period.structureId,
                type: 'COST_SPIKE',
                message: `[Alerta de Anomalía: Mano de Obra] El costo unitario de Mano de Obra ($${currentMOD.toFixed(2)}) subió un ${(devMOD * 100).toFixed(1)}% respecto al promedio histórico ($${avgMOD.toFixed(2)}). Revisá la productividad o paritarias.`,
              },
            });
          }
        }
      }

      return updated;
    });

    return closed;
  }

  /**
   * COMPARAR DOS PERÍODOS (Fase 4).
   *
   * Sin argumentos compara los dos últimos: el más nuevo contra el anterior, que es
   * lo que el costista quiere ver el 90% de las veces ("¿cómo venimos contra el mes
   * pasado?").
   *
   * De dónde salen los números de cada lado:
   *   · si el período tiene su resultado CONGELADO (se cerró después de la Fase 4),
   *     se lee tal cual: es EL número de ese mes, y no se toca;
   *   · si no (está abierto, o se cerró antes), se recalcula con el motor de hoy y
   *     se marca como `recomputed`, para no hacerlo pasar por congelado.
   */
  async compare(userId: string, structureId: string, fromCode?: string, toCode?: string) {
    await this.requireStructure(userId, structureId);

    const periods = await this.db.costPeriod.findMany({
      where: { structureId },
      orderBy: { code: 'desc' },
    });

    if (periods.length < 2) {
      throw new ValidationError(
        'Para comparar hacen falta al menos dos períodos. Cerrá el mes actual y abrí el siguiente: ' +
          'a partir de ahí el sistema puede mostrarte qué cambió y por qué.',
      );
    }

    const byCode = (code: string) => {
      const p = periods.find((x) => x.code === code);
      if (!p) throw new NotFoundError(`No existe el período "${code}" en esta estructura.`);
      return p;
    };

    // Por defecto: el último contra el anterior (vienen ordenados del más nuevo al
    // más viejo).
    const to = toCode ? byCode(toCode) : periods[0]!;
    const from = fromCode
      ? byCode(fromCode)
      : periods.find((p) => p.code < to.code) ?? periods[1]!;

    if (from.code === to.code) {
      throw new ValidationError('Elegí dos períodos distintos para comparar.');
    }

    // El más viejo siempre es el punto de partida, aunque los manden al revés: la
    // variación se lee "de mayo a junio", no "de junio a mayo".
    const [older, newer] = from.code < to.code ? [from, to] : [to, from];

    const comparison = comparePeriods(this.toSide(older), this.toSide(newer));

    let macroContrast: MacroContrast | null = null;
    if (older.status === 'CLOSED' && newer.status === 'CLOSED') {
      const inflation = await this.macro.cumulativeInflation(older.endDate, newer.endDate);
      if (inflation) {
        macroContrast = {
          indicatorCode: 'IPC_NACIONAL',
          indicatorLabel: 'Inflación nacional (IPC)',
          deltaPct: inflation.deltaPct,
          monthsUsed: inflation.monthsUsed,
          snapshots: inflation.snapshots.map((s) => ({
            value: s.value,
            effectiveDate: s.effectiveDate.toISOString().slice(0, 10),
          })),
        };
      }
    }

    return { ...comparison, macroContrast };
  }

  /** Un período tal como lo necesita la comparación, con sus números resueltos. */
  private toSide(period: CostPeriod): PeriodSide {
    const frozen = period.resultSnapshot as FrozenCalculation | null;
    const useFrozen = period.status === 'CLOSED' && frozen != null;

    return {
      code: period.code,
      label: period.label,
      status: period.status as 'OPEN' | 'CLOSED',
      source: useFrozen ? 'frozen' : 'recomputed',
      result: useFrozen ? frozen : this.computeResult(period, 'comparar'),
      rawMaterialConfig: period.rawMaterialConfig,
      indirectCostConfig: period.indirectCostConfig,
      // El costo unitario se divide por lo PRODUCIDO, no por lo vendido: producir
      // 1.000 y vender 800 son dos números distintos, y dividir por 800 infla el
      // costo. Si el período no tiene el dato (es viejo, de antes del campo), se cae
      // a las vendidas: es lo que el sistema hacía antes, no un número inventado.
      units: period.productionQuantity
        ? Number(period.productionQuantity)
        : period.salesQuantity
          ? Number(period.salesQuantity)
          : null,
      unitsAreSales: !period.productionQuantity,
    };
  }

  /**
   * Corre el motor sobre los datos del propio período. Usa `runCalculation` — la
   * misma función que el cálculo de la app — así el número del mes cerrado y el que
   * ve el costista en pantalla son, por construcción, el mismo número.
   *
   * Si los datos no alcanzan para calcular, corta con un mensaje accionable en vez
   * de devolver un resultado vacío que después nadie sabe interpretar.
   */
  private computeResult(period: PeriodLike, accion: 'cerrar' | 'comparar'): FrozenCalculation {
    try {
      const input: CalculationInput = {
        rawMaterial: rawMaterialSectionSchema.parse(period.rawMaterialConfig),
        directLabor: directLaborConfigSchema.parse(period.directLaborConfig),
        indirectCosts: indirectCostConfigSchema.parse(period.indirectCostConfig),
        inventory: inventorySchema.parse({}),
        sales: {
          unitPrice: period.salesUnitPrice ? Number(period.salesUnitPrice) : 0,
          quantity: period.salesQuantity ? Number(period.salesQuantity) : 0,
        },
      };
      const { raw: _raw, ...frozen } = runCalculation(input);
      return frozen;
    } catch (e) {
      throw new ValidationError(
        `No se puede ${accion} "${period.label}": el sistema no pudo calcular los números del período. ` +
          `Revisá que las tres secciones (materia prima, mano de obra y costos indirectos) estén completas. ` +
          `Detalle: ${(e as Error).message}`,
      );
    }
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
