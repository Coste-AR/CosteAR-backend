import type { PrismaClient, Prisma, CostPeriod } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma.js';
import { recordAudit, type AuditContext } from '../audit/audit-logger.js';
import { NotFoundError, ValidationError } from '../../domain/errors/domain-error.js';
import { MissingInputError } from '../../domain/errors/calculation-errors.js';
import {
  runCalculation,
  ENGINE_VERSION,
  type CalculationInput,
  type FrozenCalculation,
} from '../../domain/calculations/calculate.js';
import { type PeriodLike, type ProductiveSetting } from './cost-period-propagation-service.js';
import { naturalezaADominio } from './desperdicio-service.js';
import {
  totalAmortizacionDelPeriodo,
  type ActivoAmortizableDelPeriodo,
} from '../../domain/parametros/activo-amortizable.js';
import {
  resolverParametro,
  type FilaParametro,
} from '../../domain/parametros/parametros-costeo.js';
import {
  rawMaterialSectionSchema,
  directLaborConfigSchema,
  indirectCostConfigSchema,
  inventorySchema,
} from '../../shared/schemas/cost.schema.js';
import { comparePeriods, type PeriodSide, type MacroContrast } from './period-comparison.js';
import { MacroService } from '../macro/macro-service.js';
import { ProcessCalculationService } from './process-costing/process-calculation-service.js';
import { freezeProcessPeriod } from '../../domain/calculations/freeze-process-period.js';
import { detectarAnomaliasDelCierre } from '../alerts/period-anomaly-runner.js';
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
    private readonly processCalc: ProcessCalculationService = new ProcessCalculationService(db),
  ) {}

  /**
   * LOS NÚMEROS DEL PERÍODO, POR EL MOTOR QUE CORRESPONDA.
   *
   * Acá estaba el bug más grave del módulo de Procesos: el cierre y la
   * comparación corrían SIEMPRE el motor de Órdenes. En una estructura de
   * Procesos los JSON de MP/MOD/CIP están vacíos por diseño —los costos viven en
   * el cuadro de movimiento de unidades— así que el cierre fallaba siempre. Y
   * como no se puede abrir un período nuevo mientras haya otro abierto, la
   * estructura quedaba trabada en su primer período para siempre.
   */
  private async resolveResult(
    period: PeriodLike & { id: string; salesUnitPrice: unknown; salesQuantity: unknown; productionQuantity: unknown },
    structure: { id: string; userId: string; costingSystem: string; productName: string },
    accion: 'cerrar' | 'comparar',
  ): Promise<FrozenCalculation> {
    if (structure.costingSystem !== 'PROCESSES') return this.computeResult(period, accion);

    try {
      // El informe del motor da el costo de lo TERMINADO por cada departamento.
      const report = await this.processCalc.getProductionReport(
        structure.userId,
        structure.id,
        period.id,
      );

      // Los costos INCURRIDOS en el período salen del cuadro de movimiento, que
      // es donde el costista los cargó. No se derivan del informe porque cuando
      // el departamento unifica conversión, MO y CIF vienen sumados en una sola
      // columna y separarlos ahí sería repartir un número en vez de leer el real.
      const schedules = await this.db.unitMovementSchedule.findMany({
        where: { periodId: period.id },
      });
      const porDepto = new Map(schedules.map((s) => [s.departmentId, s]));

      return freezeProcessPeriod({
        departments: report.departments.map((d) => {
          const s = porDepto.get(d.id);
          return {
            name: d.name,
            sequence: d.sequence,
            periodCostMp: Number(s?.periodCostMp ?? 0),
            periodCostMo: Number(s?.periodCostMo ?? 0),
            periodCostCif: Number(s?.periodCostCif ?? 0),
            costoTerminadasYTransferidas: Number(d.report.costoTerminadasYTransferidas),
            costoTerminadasEnStock: Number(d.report.costoTerminadasEnStock),
            costoUnitarioTotalAcumulado: Number(d.report.costoUnitarioTotalAcumulado),
          };
        }),
        salesUnitPrice: Number(period.salesUnitPrice ?? 0),
        salesQuantity: Number(period.salesQuantity ?? 0),
        productionQuantity: period.productionQuantity == null ? null : Number(period.productionQuantity),
      });
    } catch (e) {
      // El motor de Procesos ya redacta sus errores en castellano y accionables
      // (cuadro que no cuadra, departamento sin datos). Se pasan tal cual en vez
      // de taparlos con el mensaje de Órdenes, que mandaba al costista a
      // completar secciones que en su pantalla no existen.
      throw new ValidationError(
        `No se puede ${accion} "${period.label}": ${(e as Error).message}`,
      );
    }
  }

  private async requireStructure(userId: string, structureId: string) {
    const s = await this.db.costStructure.findFirst({
      where: { id: structureId, userId, deletedAt: null },
      include: { company: true },
    });
    if (!s) throw new NotFoundError('Estructura de costos no encontrada');
    return s;
  }

  private async requirePeriod(userId: string, periodId: string) {
    const p = await this.db.costPeriod.findFirst({
      where: { id: periodId, userId },
      // #92 — los desperdicios vigentes viajan con el período: el motor los
      // necesita para aplicar R5 al cerrar y al comparar. Sin el `include` la
      // lista llega vacía y el desperdicio no se imputa, que es justamente el
      // agujero que este trabajo viene a tapar.
      //
      // #116 — mismo motivo para los activos amortizables y los parámetros de
      // costeo: viven a nivel EMPRESA (no de la estructura), así que viajan
      // colgados de `company`.
      include: {
        desperdicioRegistros: { where: { deletedAt: null } },
        company: {
          select: {
            activosAmortizables: { where: { deletedAt: null } },
            parametrosCosteo: { where: { deletedAt: null } },
          },
        },
      },
    });
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
    const estructura = await this.requireStructure(userId, period.structureId);
    const frozen = await this.resolveResult(period, estructura, 'cerrar');

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

      // FASE 2: Detección Proactiva de Anomalías (Alertas Tempranas).
      //
      // Corre el detector de `application/alerts/anomaly-detection.ts`, que estaba
      // testeado pero sin usar. Antes acá había una detección escrita a mano que
      // comparaba TOTALES mientras el mensaje hablaba de "costo unitario": con la
      // producción cambiando, avisaba de subas que no existían.
      //
      // Las alertas se escriben en ESTA transacción, junto con el cierre (DOM-02).
      const lastPeriods = await tx.costPeriod.findMany({
        where: { structureId: period.structureId, status: 'CLOSED', id: { not: periodId } },
        orderBy: { code: 'desc' },
        take: 6,
        select: { code: true, label: true, resultSnapshot: true },
      });

      const deteccion = detectarAnomaliasDelCierre({
        actual: { code: updated.code, label: updated.label, resultSnapshot: frozen },
        historia: lastPeriods,
        userId,
        companyId: period.companyId,
        costStructureId: period.structureId,
      });

      if (deteccion.alertas.length > 0) {
        await tx.alert.createMany({ data: deteccion.alertas });
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

    const estructura = await this.requireStructure(userId, structureId);
    const comparison = comparePeriods(
      await this.toSide(older, estructura),
      await this.toSide(newer, estructura),
    );

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
  private async toSide(
    period: CostPeriod,
    structure: { id: string; userId: string; costingSystem: string; productName: string },
  ): Promise<PeriodSide> {
    const frozen = period.resultSnapshot as FrozenCalculation | null;
    const useFrozen = period.status === 'CLOSED' && frozen != null;

    return {
      code: period.code,
      label: period.label,
      status: period.status as 'OPEN' | 'CLOSED',
      source: useFrozen ? 'frozen' : 'recomputed',
      result: useFrozen ? frozen : await this.resolveResult(period, structure, 'comparar'),
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
   * Cuánto amortizan del período los activos de la empresa (#116).
   *
   * Sin `startDate`/`endDate` (período cargado sin el `include` que los trae)
   * no hay cómo decidir qué activo corresponde: da cero, el mismo
   * comportamiento que antes de que este dato existiera. La vida útil sale del
   * propio activo si la tiene, o si no, del catálogo de parámetros de costeo
   * (#115) — nunca de una constante.
   */
  private amortizacionDelPeriodo(period: PeriodLike): number {
    if (!period.startDate || !period.endDate) return 0;
    const activos = period.company?.activosAmortizables ?? [];
    if (activos.length === 0) return 0;

    const filasParametros: FilaParametro[] = (period.company?.parametrosCosteo ?? []).map((p) => ({
      clave: p.clave,
      valorNum: p.valorNum === null ? null : Number(p.valorNum),
      periodId: p.periodId,
      structureId: p.structureId,
      confirmado: p.confirmado,
    }));

    const paraElMotor: ActivoAmortizableDelPeriodo[] = activos
      // `structureId: null` en el activo = vale para toda la empresa.
      .filter((a) => a.structureId === null || a.structureId === period.structureId)
      .map((a) => ({
        costoAdquisicion: Number(a.costoAdquisicion),
        valorResidual: Number(a.valorResidual),
        vidaUtilMeses:
          a.vidaUtilMeses ??
          resolverParametro('vida_util_lote_meses', filasParametros, {
            structureId: period.structureId,
            periodId: period.id,
          }).valor,
        fechaAlta: a.fechaAlta,
      }));

    return totalAmortizacionDelPeriodo(paraElMotor, period.startDate, period.endDate);
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
        // #92 — R5. Los desperdicios declarados del período entran al motor por
        // acá. Si el período se cargó sin `include`, la lista viene vacía y el
        // cálculo da lo mismo que antes: no imputar nada es el comportamiento
        // correcto cuando no hay nada declarado.
        desperdicios: (period.desperdicioRegistros ?? []).map((d) => ({
          concepto: d.concepto,
          valor: Number(d.valor),
          // La base guarda MAYÚSCULAS y el dominio minúsculas: se traduce con la
          // misma función que usa el servicio, y no a mano. Un mapeo suelto que
          // no matchea deja la naturaleza en `null`, y un registro sin naturaleza
          // NO entra al cálculo: el desperdicio desaparecería en silencio.
          naturaleza: naturalezaADominio(d.naturaleza),
          valorRecupero: Number(d.valorRecupero),
        })),
        // #90 — trabajos de terceros del período: columna propia, no CIP.
        thirdPartyWork: Number(period.thirdPartyWork ?? 0),
        // #116 — amortización de los activos de la empresa que corresponden a
        // este período, derivada del catálogo de parámetros de costeo (#115).
        assetDepreciation: this.amortizacionDelPeriodo(period),
        inventory: inventorySchema.parse({}),
        sales: {
          unitPrice: period.salesUnitPrice ? Number(period.salesUnitPrice) : 0,
          quantity: period.salesQuantity ? Number(period.salesQuantity) : 0,
          productionQuantity:
            period.productionQuantity == null ? null : Number(period.productionQuantity),
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
