import type { PrismaClient, Prisma, CostPeriod } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma.js';
import { recordAudit, type AuditContext } from '../audit/audit-logger.js';
import { NotFoundError, ValidationError } from '../../domain/errors/domain-error.js';
import {
  periodBounds,
  nextPeriodCode,
  normalizeLegacyCode,
  type Periodicity,
} from '../../domain/periods/period-calendar.js';
import {
  closingStockOf,
  type MaterialClosingBalance,
} from '../../domain/periods/closing-stock.js';
import {
  runCalculation,
  ENGINE_VERSION,
  type CalculationInput,
  type FrozenCalculation,
} from './calculate.js';
import {
  rawMaterialSectionSchema,
  directLaborConfigSchema,
  indirectCostConfigSchema,
  inventorySchema,
} from '../../shared/schemas/cost.schema.js';
import { comparePeriods, type PeriodSide } from './period-comparison.js';

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

/** Los datos con los que nace un período (y con los que amanece la pantalla). */
interface PeriodSeed {
  rawMaterialConfig?: Prisma.InputJsonValue;
  directLaborConfig?: Prisma.InputJsonValue;
  indirectCostConfig?: Prisma.InputJsonValue;
  salesUnitPrice?: Prisma.Decimal | number | null;
  salesQuantity?: Prisma.Decimal | number | null;
  productionQuantity?: Prisma.Decimal | number | null;
}

/** Un período tal como lo lee el arrastre (solo lo que necesita). */
interface PeriodLike {
  code: string;
  label: string;
  rawMaterialConfig: Prisma.JsonValue;
  directLaborConfig: Prisma.JsonValue;
  indirectCostConfig: Prisma.JsonValue;
  salesUnitPrice: Prisma.Decimal | null;
  salesQuantity: Prisma.Decimal | null;
  productionQuantity?: Prisma.Decimal | null;
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
   * Qué va a pasar si abro el período siguiente (Fase 3: apertura inteligente).
   *
   * Es lo que el diálogo de apertura le muestra al costista ANTES de tocar nada:
   * qué mes se abre, con cuánta existencia de cada materia prima arranca y a qué
   * PPP, y qué importes hay para traer si los quiere.
   */
  async previewNext(userId: string, structureId: string) {
    const structure = await this.requireStructure(userId, structureId);
    const periodicity = structure.company.periodicity as Periodicity;

    const open = await this.db.costPeriod.findFirst({ where: { structureId, status: 'OPEN' } });
    const last = await this.db.costPeriod.findFirst({
      where: { structureId },
      orderBy: { code: 'desc' },
    });

    const code = last
      ? nextPeriodCode(normalizeLegacyCode(last.code, periodicity), periodicity)
      : normalizeLegacyCode(structure.period, periodicity);
    const bounds = periodBounds(code, periodicity);

    // La existencia arrastrada se deriva de la ficha de stock del mes que cierra.
    // Si esa ficha no cuadra, no rompemos el diálogo: se lo decimos al costista.
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
      /** El primer período de la estructura no arrastra: fotografía lo que ya hay. */
      isFirst: !last,
      /** Si hay uno abierto, no se puede abrir otro (hay que cerrarlo antes). */
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

  /** Los importes que el costista puede elegir traer: sueldos y CIF. */
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

    const last = (await this.db.costPeriod.findFirst({
      where: { structureId },
      orderBy: { code: 'desc' },
    })) as PeriodLike | null;

    const code = last
      ? nextPeriodCode(normalizeLegacyCode(last.code, periodicity), periodicity)
      : normalizeLegacyCode(structure.period, periodicity);

    const bounds = periodBounds(code, periodicity);

    // Con qué datos nace el período:
    //   · el PRIMERO fotografía lo que la estructura ya tiene cargado (no se
    //     arrastra nada de ningún lado, y la pantalla no se toca);
    //   · los SIGUIENTES arrastran del anterior.
    const seed = last ? this.carryOver(last, carry) : this.snapshotOf(structure);
    const openingStock = last ? closingStockOf(last.rawMaterialConfig) : [];

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

      // La pantalla amanece en el mes nuevo: la estructura (donde la app escribe)
      // queda con lo arrastrado. Lo del mes que cerró no se pierde — vive en su
      // período y en el historial append-only de configs.
      if (last) {
        await this.resetStructureTo(tx, structureId, userId, seed, bounds.code, last.label);
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
            // Queda asentado con qué existencia arranca cada MP y de dónde salió.
            openingStock,
          },
        },
        tx,
      );

      return created;
    });
  }

  /** El primer período fotografía lo que la estructura tiene hoy. */
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

  /**
   * Qué datos arrastra el período nuevo desde el anterior.
   *
   *   · La RECETA (centros, bases, departamentos, capacidad normal) siempre.
   *   · La EXISTENCIA FINAL de cada MP, como existencia inicial, valuada al PPP
   *     de cierre (Fase 3). Es la única cifra del mes anterior que SÍ viaja,
   *     porque contablemente es el punto de partida del mes que abre.
   *   · Los IMPORTES (CIF y sueldos), solo si el costista lo pidió.
   *   · Lo que es del mes — compras, consumos, actividad real, CIP real — NUNCA:
   *     arrastrarlo sería costear julio con los movimientos de junio.
   */
  private carryOver(last: PeriodLike, carry: CarryOverOptions): PeriodSeed {
    const clone = <T>(v: T): T => (v == null ? v : JSON.parse(JSON.stringify(v)));

    // ── Materia prima: la ficha del insumo sí, los movimientos del mes no, y la
    //    existencia inicial pasa a ser con la que cerró el mes anterior.
    const closing = closingStockOf(last.rawMaterialConfig);
    const rm = clone(last.rawMaterialConfig) as {
      materials?: Record<string, unknown>[];
    } | null;
    if (rm && Array.isArray(rm.materials)) {
      rm.materials.forEach((m, i) => {
        m.movements = []; // compras y consumos son del mes que arranca
        const c = closing[i];
        if (c) m.initialStock = { quantity: c.quantity, unitCost: c.unitCost };
      });
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
      rawMaterialConfig: (rm ?? undefined) as Prisma.InputJsonValue,
      directLaborConfig: (dl ?? undefined) as Prisma.InputJsonValue,
      indirectCostConfig: (ic ?? undefined) as Prisma.InputJsonValue,
      // El precio de venta es lista de precios (parte del molde): viaja.
      // Las unidades —vendidas y producidas— son del mes: arrancan en cero, siempre.
      salesUnitPrice: last.salesUnitPrice,
      salesQuantity: 0,
      productionQuantity: 0,
    };
  }

  /**
   * Deja la estructura (donde la app escribe) con los datos del período nuevo, y
   * versiona el cambio en el historial append-only: el reseteo de apertura queda
   * tan trazable como cualquier edición del costista.
   */
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
        period: code, // el campo viejo tipeado a mano queda en sincronía
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

    return comparePeriods(this.toSide(older), this.toSide(newer));
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
