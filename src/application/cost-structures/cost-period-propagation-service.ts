import type { NaturalezaDesperdicio as NaturalezaDb, PrismaClient, Prisma } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma.js';
import { recordAudit, type AuditContext } from '../audit/audit-logger.js';
import { NotFoundError, ValidationError } from '../../domain/errors/domain-error.js';
import {
  periodBounds,
  nextPeriodCode,
  normalizeLegacyCode,
} from '../../domain/periods/period-calendar.js';
import { effectiveRhythm } from '../../domain/periods/effective-rhythm.js';
import {
  closingStockOf,
  type MaterialClosingBalance,
} from '../../domain/periods/closing-stock.js';
import { ProcessCalculationService } from './process-costing/process-calculation-service.js';

export interface CarryOverOptions {
  recipe?: true;
  amounts?: boolean;
}

export interface ProductiveSetting {
  centerId?: string;
  actualActivity?: number;
  actualCip?: number;
  [k: string]: unknown;
}

export interface PeriodSeed {
  rawMaterialConfig?: Prisma.InputJsonValue;
  directLaborConfig?: Prisma.InputJsonValue;
  indirectCostConfig?: Prisma.InputJsonValue;
  salesUnitPrice?: Prisma.Decimal | number | null;
  salesQuantity?: Prisma.Decimal | number | null;
  productionQuantity?: Prisma.Decimal | number | null;
}

export interface PeriodLike {
  code: string;
  label: string;
  rawMaterialConfig: Prisma.JsonValue;
  directLaborConfig: Prisma.JsonValue;
  indirectCostConfig: Prisma.JsonValue;
  salesUnitPrice: Prisma.Decimal | null;
  salesQuantity: Prisma.Decimal | null;
  productionQuantity?: Prisma.Decimal | null;
  status?: string;
  id?: string;
  /** Trabajos de terceros del período (#90). Columna propia, default 0. */
  thirdPartyWork?: Prisma.Decimal | number | null;
  /**
   * Desperdicios declarados del período (#92). Opcional: un período cargado sin
   * `include` no los trae, y entonces el motor no imputa ninguno — que es lo
   * mismo que pasaba antes de que este dato existiera.
   */
  desperdicioRegistros?: Array<{
    concepto: string;
    valor: Prisma.Decimal;
    naturaleza: NaturalezaDb | null;
    valorRecupero: Prisma.Decimal;
  }>;
}

/**
 * Lo que la existencia final de UN departamento deja para el período siguiente
 * (B18): las mismas unidades físicas, los mismos grados de avance y el costo con
 * el que cerraron, repartido por elemento.
 */
export interface ProcessWipCarry {
  departmentId: string;
  departmentName: string;
  initialWip: number;
  initialWipMpAvance: number | null;
  initialWipConvAvance: number | null;
  initialWipCostMp: number;
  initialWipCostMo: number;
  initialWipCostCif: number;
  initialWipCostPrevDept: number;
}

export class CostPeriodPropagationService {
  constructor(
    private readonly db: PrismaClient = prisma,
    private readonly processCalc: ProcessCalculationService = new ProcessCalculationService(db),
  ) {}

  private async requireStructure(userId: string, structureId: string) {
    const s = await this.db.costStructure.findFirst({
      where: { id: structureId, userId, deletedAt: null },
      include: { company: true },
    });
    if (!s) throw new NotFoundError('Estructura de costos no encontrada');
    return s;
  }

  async previewNext(userId: string, structureId: string) {
    const structure = await this.requireStructure(userId, structureId);
    const periodicity = effectiveRhythm(structure, structure.company.periodicity);

    const open = await this.db.costPeriod.findFirst({ where: { structureId, status: 'OPEN' } });
    const last = await this.db.costPeriod.findFirst({
      where: { structureId },
      orderBy: { code: 'desc' },
    });

    const code = last
      ? nextPeriodCode(normalizeLegacyCode(last.code, periodicity), periodicity)
      : normalizeLegacyCode(structure.period, periodicity);
    const bounds = periodBounds(code, periodicity);

    let openingStock: MaterialClosingBalance[] = [];
    let openingStockError: string | null = null;
    if (last) {
      try {
        openingStock = closingStockOf(last.rawMaterialConfig);
      } catch (e) {
        openingStockError = (e as Error).message;
      }
    }

    return {
      isFirst: !last,
      blockedBy: open ? { id: open.id, label: open.label } : null,
      next: {
        code: bounds.code,
        label: bounds.label,
        startDate: bounds.startDate,
        endDate: bounds.endDate,
      },
      from: last ? { id: last.id, code: last.code, label: last.label, status: last.status } : null,
      openingStock,
      openingStockError,
      amounts: last ? this.amountsOf(last) : null,
    };
  }

  private amountsOf(period: PeriodLike): { wages: number; indirect: number } {
    const dl = period.directLaborConfig as { departments?: { basicRemuneration?: number }[] } | null;
    const ic = period.indirectCostConfig as
      | { concepts?: { amount?: { fixed?: number; variable?: number } }[] }
      | null;

    const wages = (dl?.departments ?? []).reduce((a, d) => a + Number(d.basicRemuneration ?? 0), 0);
    const indirect = (ic?.concepts ?? []).reduce(
      (a, c) => a + Number(c.amount?.fixed ?? 0) + Number(c.amount?.variable ?? 0),
      0,
    );
    return { wages, indirect };
  }

  async openNext(
    userId: string,
    structureId: string,
    carry: CarryOverOptions,
    ctx: AuditContext,
  ) {
    const structure = await this.requireStructure(userId, structureId);
    const periodicity = effectiveRhythm(structure, structure.company.periodicity);

    const open = await this.db.costPeriod.findFirst({ where: { structureId, status: 'OPEN' } });
    if (open) {
      throw new ValidationError(
        `No se puede abrir un período nuevo: "${open.label}" sigue abierto. Cerralo primero.`,
      );
    }

    const last = (await this.db.costPeriod.findFirst({
      where: { structureId },
      orderBy: { code: 'desc' },
    })) as PeriodLike | null;

    const code = last
      ? nextPeriodCode(normalizeLegacyCode(last.code, periodicity), periodicity)
      : normalizeLegacyCode(structure.period, periodicity);

    const bounds = periodBounds(code, periodicity);

    const seed = last ? this.carryOver(last, carry) : this.snapshotOf(structure);
    const openingStock = last ? closingStockOf(last.rawMaterialConfig) : [];

    // B18 — Costeo por Procesos: la producción no se corta a fin de mes, así que
    // lo que quedó a medio hacer en cada departamento es, literalmente, con lo
    // que arranca el mes siguiente. Se resuelve ANTES de la transacción porque
    // hay que correr el motor sobre el período que cierra para valuar esa
    // existencia final (mismo criterio que `close()` con `computeResult`).
    const processCarry =
      last && structure.costingSystem === 'PROCESSES'
        ? await this.processWipCarryOver(userId, structureId, last)
        : [];

    return this.db.$transaction(async (tx) => {
      const created = await tx.costPeriod.create({
        data: {
          structureId,
          companyId: structure.companyId,
          userId,
          code: bounds.code,
          label: bounds.label,
          startDate: bounds.startDate,
          endDate: bounds.endDate,
          status: 'OPEN',
          ...seed,
        },
      });

      if (last) {
        await this.resetStructureTo(tx, structureId, userId, seed, bounds.code, last.label);
      }

      // El cuadro de movimiento del mes nuevo nace con la existencia inicial ya
      // cargada: mismas unidades, mismos avances y el costo con el que cerró.
      for (const c of processCarry) {
        await tx.unitMovementSchedule.create({
          data: {
            departmentId: c.departmentId,
            periodId: created.id,
            initialWip: c.initialWip,
            initialWipMpAvance: c.initialWipMpAvance,
            initialWipConvAvance: c.initialWipConvAvance,
            initialWipCostMp: c.initialWipCostMp,
            initialWipCostMo: c.initialWipCostMo,
            initialWipCostCif: c.initialWipCostCif,
            initialWipCostPrevDept: c.initialWipCostPrevDept,
          },
        });
      }

      await recordAudit(
        {
          ...ctx,
          userId,
          action: 'cost_period.open',
          entityType: 'CostPeriod',
          entityId: created.id,
          newValue: {
            code: created.code,
            carry,
            from: last?.code ?? null,
            openingStock,
            // Qué arrastró cada departamento, por nombre (nunca ids en la traza
            // que después se muestra).
            processWipCarry: processCarry.map((c) => ({
              departamento: c.departmentName,
              unidades: c.initialWip,
              avanceMp: c.initialWipMpAvance,
              avanceConversion: c.initialWipConvAvance,
              costoMp: c.initialWipCostMp,
              costoMo: c.initialWipCostMo,
              costoCif: c.initialWipCostCif,
              costoDepartamentoAnterior: c.initialWipCostPrevDept,
            })),
          },
        },
        tx,
      );

      return created;
    });
  }

  /**
   * REPROPAGACIÓN HACIA ADELANTE.
   *
   * Se usa cuando un período ya cerrado se toca de nuevo (llegó una factura
   * atrasada y el costista autorizó reabrirlo). La identidad de la cátedra
   * —"el inventario final del período 1 es el inventario inicial del período
   * 2"— no es una convención: es la misma mercadería. Si el período 1 cambia y
   * el 2 no se actualiza, la cadena queda aritméticamente rota y el costo
   * unitario de todos los meses siguientes miente.
   *
   * Recorre los períodos POSTERIORES en orden y reescribe la existencia inicial
   * de cada uno con lo que dejó el anterior, reusando exactamente el mismo
   * cálculo que usa la apertura normal (`processWipCarryOver`): el número que
   * arrastra una corrección y el que arrastra una apertura son, por
   * construcción, el mismo número.
   *
   * Devuelve qué períodos tocó, para que quien la llame lo deje asentado en la
   * bitácora y el costista vea qué meses se movieron por su decisión.
   */
  async repropagateForward(
    userId: string,
    structureId: string,
    fromPeriodCode: string,
  ): Promise<{ periodCode: string; periodLabel: string; departamentos: number }[]> {
    const structure = await this.requireStructure(userId, structureId);
    if (structure.costingSystem !== 'PROCESSES') return [];

    const posteriores = await this.db.costPeriod.findMany({
      where: { structureId, deletedAt: null, code: { gt: fromPeriodCode } },
      orderBy: { code: 'asc' },
    });
    if (posteriores.length === 0) return [];

    const anterior = await this.db.costPeriod.findFirst({
      where: { structureId, deletedAt: null, code: fromPeriodCode },
    });
    if (!anterior) return [];

    const tocados: { periodCode: string; periodLabel: string; departamentos: number }[] = [];
    let previo = anterior as unknown as PeriodLike;

    for (const periodo of posteriores) {
      // El motor tiene que poder valuar la existencia final del período previo.
      // Si no puede (datos incompletos a mitad de la cadena), se corta acá: es
      // preferible dejar la cadena a medio propagar y avisar, a escribir un
      // arrastre inventado en los meses que siguen.
      const carries = await this.processWipCarryOver(userId, structureId, previo);
      if (carries.length === 0) break;

      for (const c of carries) {
        // UPSERT y no update: el período siguiente puede no tener todavía cuadro
        // de movimiento para este departamento. Con un `updateMany` eso no
        // escribía nada Y NO FALLABA — la repropagación informaba haber tocado
        // un mes en el que no había escrito una sola fila, y esa mentira quedaba
        // asentada en la bitácora. Crear la fila es exactamente lo que hace la
        // apertura normal de un período (`openNext`), así que el arrastre queda
        // igual por los dos caminos.
        const arrastre = {
          initialWip: c.initialWip,
          initialWipMpAvance: c.initialWipMpAvance,
          initialWipConvAvance: c.initialWipConvAvance,
          initialWipCostMp: c.initialWipCostMp,
          initialWipCostMo: c.initialWipCostMo,
          initialWipCostCif: c.initialWipCostCif,
          initialWipCostPrevDept: c.initialWipCostPrevDept,
        };
        await this.db.unitMovementSchedule.upsert({
          where: { departmentId_periodId: { departmentId: c.departmentId, periodId: periodo.id } },
          create: { departmentId: c.departmentId, periodId: periodo.id, ...arrastre },
          update: arrastre,
        });
      }

      tocados.push({
        periodCode: periodo.code,
        periodLabel: periodo.label,
        departamentos: carries.length,
      });
      previo = periodo as unknown as PeriodLike;
    }

    return tocados;
  }

  /**
   * ARRASTRE DE PRODUCCIÓN EN PROCESO ENTRE PERÍODOS (B18).
   *
   * Regla de la cátedra: "el inventario final del período 1 es el inventario
   * inicial del período 2". Las mismas unidades físicas, los mismos grados de
   * avance, y el costo con el que cerraron — incluido, en los departamentos
   * sucesivos, el costo del departamento anterior que esa existencia ya traía
   * adentro (costo modificado + CAUP).
   *
   * La valuación de la existencia final NO se recalcula a mano acá: sale del
   * informe de costos que produce el motor sobre el período que cierra, para
   * que el número que arrastra el sistema y el que el costista ve en pantalla
   * sean, por construcción, el mismo número.
   *
   * Si la estructura todavía no tiene departamentos o el período que cierra no
   * tiene cuadros de movimiento, no hay nada que arrastrar y la apertura sigue
   * normal — abrir un mes nuevo nunca se bloquea por falta de datos de Procesos.
   * En cambio, si los datos existen pero no cierran, el motor tira su 422
   * accionable y la apertura se detiene: arrastrar un número mal calculado sería
   * peor que no arrastrarlo.
   */
  private async processWipCarryOver(
    userId: string,
    structureId: string,
    last: PeriodLike,
  ): Promise<ProcessWipCarry[]> {
    if (!last.id) return [];

    const departments = await this.db.processDepartment.findMany({
      where: { structureId, deletedAt: null },
      orderBy: { sequence: 'asc' },
    });
    if (departments.length === 0) return [];

    const schedules = await this.db.unitMovementSchedule.findMany({
      where: { periodId: last.id, departmentId: { in: departments.map((d) => d.id) } },
    });
    if (schedules.length === 0) return [];

    const report = await this.processCalc.getProductionReport(userId, structureId, last.id);
    const resultByDept = new Map(report.departments.map((d) => [d.id, d]));
    const scheduleByDept = new Map(schedules.map((s) => [s.departmentId, s]));

    const carries: ProcessWipCarry[] = [];
    for (const dept of departments) {
      const result = resultByDept.get(dept.id);
      const schedule = scheduleByDept.get(dept.id);
      if (!result || !schedule) continue;

      const valuacionEF = (element: string) =>
        result.report.elements.find((e) => e.element === element)?.valuacionEF ?? 0;

      let costMo: number;
      let costCif: number;
      if (result.conversionUnified) {
        // El departamento sigue MOD y CIP como una sola columna "Conversión", así
        // que el informe valúa la EF en un único número. La tabla, en cambio,
        // guarda MO y CIF por separado: lo repartimos en la MISMA proporción con
        // la que el departamento cerró el período. Mientras siga unificado el
        // reparto es indistinto (el motor vuelve a sumarlos), y si algún día se
        // separa, arranca con una proporción real en vez de un número inventado.
        const costoConversionEF = valuacionEF('CC');
        const moTotal = Number(schedule.initialWipCostMo ?? 0) + Number(schedule.periodCostMo ?? 0);
        const cifTotal =
          Number(schedule.initialWipCostCif ?? 0) + Number(schedule.periodCostCif ?? 0);
        const base = moTotal + cifTotal;
        costMo = base > 0 ? costoConversionEF * (moTotal / base) : costoConversionEF;
        costCif = base > 0 ? costoConversionEF * (cifTotal / base) : 0;
      } else {
        costMo = valuacionEF('MOD');
        costCif = valuacionEF('CIP');
      }

      carries.push({
        departmentId: dept.id,
        departmentName: dept.name,
        initialWip: result.schedule.finalWip,
        // Los avances con los que cerró la EF son, tal cual, los de la EI nueva.
        initialWipMpAvance:
          schedule.finalWipMpAvance == null ? null : Number(schedule.finalWipMpAvance),
        initialWipConvAvance:
          schedule.finalWipConvAvance == null ? null : Number(schedule.finalWipConvAvance),
        initialWipCostMp: valuacionEF('MP'),
        initialWipCostMo: costMo,
        initialWipCostCif: costCif,
        initialWipCostPrevDept: result.report.previousDepartment?.valuacionEF ?? 0,
      });
    }

    return carries;
  }

  private snapshotOf(structure: {
    rawMaterialConfig: Prisma.JsonValue;
    directLaborConfig: Prisma.JsonValue;
    indirectCostConfig: Prisma.JsonValue;
    salesUnitPrice: Prisma.Decimal | null;
    salesQuantity: Prisma.Decimal | null;
    productionQuantity: Prisma.Decimal | null;
  }): PeriodSeed {
    return {
      rawMaterialConfig: (structure.rawMaterialConfig ?? undefined) as Prisma.InputJsonValue,
      directLaborConfig: (structure.directLaborConfig ?? undefined) as Prisma.InputJsonValue,
      indirectCostConfig: (structure.indirectCostConfig ?? undefined) as Prisma.InputJsonValue,
      salesUnitPrice: structure.salesUnitPrice,
      salesQuantity: structure.salesQuantity,
      productionQuantity: structure.productionQuantity,
    };
  }

  private carryOver(last: PeriodLike, carry: CarryOverOptions): PeriodSeed {
    const clone = <T>(v: T): T => (v == null ? v : JSON.parse(JSON.stringify(v)));

    const closing = closingStockOf(last.rawMaterialConfig);
    const rm = clone(last.rawMaterialConfig) as {
      materials?: Record<string, unknown>[];
    } | null;
    if (rm && Array.isArray(rm.materials)) {
      rm.materials.forEach((m, i) => {
        m.movements = [];
        const c = closing[i];
        if (c) m.initialStock = { quantity: c.quantity, unitCost: c.unitCost };
      });
    }

    const dl = clone(last.directLaborConfig) as
      | { departments?: { basicRemuneration?: number }[] }
      | null;
    if (dl && Array.isArray(dl.departments) && !carry.amounts) {
      for (const d of dl.departments) d.basicRemuneration = 0;
    }

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
      rawMaterialConfig: (rm ?? undefined) as Prisma.InputJsonValue,
      directLaborConfig: (dl ?? undefined) as Prisma.InputJsonValue,
      indirectCostConfig: (ic ?? undefined) as Prisma.InputJsonValue,
      salesUnitPrice: last.salesUnitPrice,
      salesQuantity: 0,
      productionQuantity: 0,
    };
  }

  private async resetStructureTo(
    tx: Prisma.TransactionClient,
    structureId: string,
    userId: string,
    seed: PeriodSeed,
    code: string,
    fromLabel: string,
  ) {
    await tx.costStructure.update({
      where: { id: structureId },
      data: {
        rawMaterialConfig: seed.rawMaterialConfig,
        directLaborConfig: seed.directLaborConfig,
        indirectCostConfig: seed.indirectCostConfig,
        salesUnitPrice: seed.salesUnitPrice ?? null,
        salesQuantity: seed.salesQuantity ?? null,
        productionQuantity: seed.productionQuantity ?? null,
        period: code,
      },
    });

    const reason = `Apertura del período ${code} (arrastre desde ${fromLabel})`;
    const sections: [string, Prisma.InputJsonValue | undefined][] = [
      ['rawMaterial', seed.rawMaterialConfig],
      ['directLabor', seed.directLaborConfig],
      ['indirectCosts', seed.indirectCostConfig],
      [
        'sales',
        {
          salesUnitPrice: Number(seed.salesUnitPrice ?? 0),
          salesQuantity: Number(seed.salesQuantity ?? 0),
          productionQuantity: Number(seed.productionQuantity ?? 0),
        },
      ],
    ];

    for (const [section, value] of sections) {
      if (value === undefined) continue;
      const last = await tx.costConfigVersion.findFirst({
        where: { structureId, section },
        orderBy: { versionN: 'desc' },
        select: { versionN: true },
      });
      await tx.costConfigVersion.create({
        data: {
          structureId,
          section,
          versionN: (last?.versionN ?? 0) + 1,
          value,
          createdBy: userId,
          reason,
        },
      });
    }
  }
}
