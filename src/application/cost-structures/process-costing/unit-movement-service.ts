import type { PrismaClient, Prisma } from '@prisma/client';
import { prisma, withTenant } from '../../../infrastructure/database/prisma.js';
import { recordTraceAudit, type TraceActor } from '../../audit/trace-audit.js';
import { DataPointService } from '../../trazabilidad/data-point-service.js';
import {
  buildUnitMovementSchedule,
  calcEquivalentProduction,
  type UnitMovementSchedule,
  type EquivalentProductionInput,
} from '../../../domain/calculations/process-costing.js';
import { ProcessValidationError } from '../../../domain/errors/calculation-errors.js';
import { NotFoundError, UnprocessableEntityError } from '../../../domain/errors/domain-error.js';
import type { UnitMovementInputBody } from '../../../shared/schemas/unit-movement.schema.js';

/**
 * COSTEO POR PROCESOS · CUADRO DE MOVIMIENTO DE UNIDADES COMO SERVICIO (B15)
 *
 * Hace editable y persistente el cuadro de movimiento de UN departamento para
 * UN período, apoyándose en las funciones PURAS del dominio (`buildUnitMovementSchedule`
 * B06, `calcEquivalentProduction` B07): el servicio nunca reimplementa la
 * matemática, solo la orquesta (validar → persistir → auditar → trazar).
 *
 * TRAZABILIDAD (el punto de la tarea): cada valor que el usuario CARGA A MANO
 * se persiste como un `DataPoint` versionado, reutilizando `DataPointService`
 * (no un mecanismo paralelo). Los valores DERIVADOS por diferencia
 * (`transferredOut` o `finalWip`, el que el usuario no cargó) NO son DataPoints:
 * son computados, no ingresados. Así el frontend puede abrir una ficha de
 * trazabilidad sobre cada cifra realmente cargada del cuadro.
 *
 * Todo lo que muta corre dentro de UNA transacción (`withTenant`, que además
 * setea el tenant para RLS) y deja su auditoría en esa misma transacción.
 */

/** Campos del cuadro que el usuario puede cargar a mano (los que consume B06). */
const CUADRO_FIELDS = [
  'initialWip',
  'startedInProduction',
  'receivedFromPrevious',
  'unitIncrease',
  'transferredOut',
  'finishedInStock',
  'normalLossPct',
  'totalLossReported',
  'finalWip',
] as const;
type CuadroField = (typeof CUADRO_FIELDS)[number];

/**
 * Metadatos de trazabilidad por campo del cuadro. `element` es MP para TODOS:
 * el cuadro de movimiento sigue UNIDADES FÍSICAS del producto (la materia que
 * fluye por el proceso), no un elemento del costo puntual — la apertura por
 * elemento (MOD/CIP) recién aparece en la producción equivalente (B07). El enum
 * `CostElement` no tiene una opción "unidades", así que MP es el hogar natural
 * y estable de estas cifras. Ver DECISIONES.md (B15).
 */
/**
 * Costos del período y de la existencia inicial, por elemento. NO entran al
 * cuadro de unidades (B06 solo mueve unidades físicas): son los importes que el
 * motor consume para valuar esa producción. Van en la misma tabla y se cargan en
 * el mismo acto, pero se persisten y se trazan aparte — con su elemento del
 * costo real, no con el MP genérico de las unidades.
 *
 * Sin esto no había NINGÚN endpoint que escribiera `periodCostMp/Mo/Cif`: el
 * motor los leía siempre en 0 y el costo por procesos daba cero.
 */
const COST_FIELDS = [
  'periodCostMp',
  'periodCostMo',
  'periodCostCif',
  'initialWipCostMp',
  'initialWipCostMo',
  'initialWipCostCif',
] as const;
type CostField = (typeof COST_FIELDS)[number];

type TraceableField = CuadroField | CostField;

const COST_META: Record<CostField, { label: string; unit: string; element: 'MP' | 'MOD' | 'CIP' }> = {
  periodCostMp: { label: 'Costo de materia prima del período', unit: '$', element: 'MP' },
  periodCostMo: { label: 'Costo de mano de obra del período', unit: '$', element: 'MOD' },
  periodCostCif: { label: 'Carga fabril del período', unit: '$', element: 'CIP' },
  initialWipCostMp: { label: 'Materia prima de la existencia inicial', unit: '$', element: 'MP' },
  initialWipCostMo: { label: 'Mano de obra de la existencia inicial', unit: '$', element: 'MOD' },
  initialWipCostCif: { label: 'Carga fabril de la existencia inicial', unit: '$', element: 'CIP' },
};

const FIELD_META: Record<CuadroField, { label: string; unit: string; element: 'MP' }> = {
  initialWip: { label: 'Existencia inicial en proceso', unit: 'u', element: 'MP' },
  startedInProduction: { label: 'Puestas en elaboración', unit: 'u', element: 'MP' },
  receivedFromPrevious: { label: 'Recibidas del departamento anterior', unit: 'u', element: 'MP' },
  unitIncrease: { label: 'Aumento de número de unidades', unit: 'u', element: 'MP' },
  transferredOut: { label: 'Terminadas y transferidas', unit: 'u', element: 'MP' },
  finishedInStock: { label: 'Terminadas en existencia', unit: 'u', element: 'MP' },
  normalLossPct: { label: 'Pérdida normal admitida', unit: '%', element: 'MP' },
  totalLossReported: { label: 'Pérdida real total del período', unit: 'u', element: 'MP' },
  finalWip: { label: 'Existencia final en proceso', unit: 'u', element: 'MP' },
};

interface ProcessContext {
  structure: { id: string; productName: string };
  department: { id: string; name: string; sequence: number; defaultConversionAvanceEqualsMO: boolean };
  period: { id: string; label: string; code: string };
}

type NumericValues = Record<CuadroField, number | undefined>;

export class UnitMovementService {
  constructor(
    private readonly db: PrismaClient = prisma,
    private readonly dataPoints: DataPointService = new DataPointService(db),
  ) {}

  /**
   * Devuelve el cuadro guardado + su versión RESUELTA (corre el dominio, así
   * vuelven los valores derivados por diferencia y el estado "cuadra / no
   * cuadra"), más el `dataPointId` de cada cifra trazable para que el front
   * abra la ficha.
   */
  async get(userId: string, structureId: string, deptId: string, periodId: string) {
    const ctx = await this.resolveContext(userId, structureId, deptId, periodId);
    const row = await this.db.unitMovementSchedule.findUnique({
      where: { departmentId_periodId: { departmentId: deptId, periodId } },
    });

    if (!row) {
      return {
        department: ctx.department.name,
        period: ctx.period.label,
        exists: false,
        saved: null,
        resolved: null,
        traces: this.emptyTraces(),
      };
    }

    const resolved = this.resolve(ctx, this.rowValues(row));
    return {
      department: ctx.department.name,
      period: ctx.period.label,
      exists: true,
      saved: this.serializeRow(row),
      resolved: this.serialize(resolved),
      traces: await this.tracesFor(ctx),
    };
  }

  /**
   * Persiste el cuadro (upsert por departamento+período), valida con el dominio
   * (deriva por diferencia y verifica que cuadra), y traza cada valor manual.
   * TODO en una sola transacción atómica y auditada.
   */
  /**
   * ¿Quién está informando este grado de avance?
   *
   * `TECHNICAL_OFFICE` si lo carga un operario de la empresa con el permiso de
   * recuento habilitado (la oficina técnica). `COSTIST_ESTIMATE` en cualquier
   * otro caso — típicamente el costista cargándolo él porque planta no
   * respondió.
   *
   * Los dos se aceptan. Prohibir el segundo dejaría el sistema inusable el día
   * que planta no contesta, y el costista terminaría cargándolo igual desde otro
   * lado. Lo que no se puede es que los dos queden iguales en la base: un
   * informe apoyado en un recuento real y otro apoyado en una estimación no
   * valen lo mismo, y esa diferencia se lee después en la trazabilidad.
   */
  private async countSourceFor(userId: string, actor: TraceActor): Promise<'TECHNICAL_OFFICE' | 'COSTIST_ESTIMATE'> {
    if (actor.id === userId) return 'COSTIST_ESTIMATE'; // el costista, dueño de la estructura

    const membership = await this.db.operatorMembership.findFirst({
      where: { operatorId: actor.id, isActive: true, canReportWipCount: true },
      select: { id: true },
    });
    return membership ? 'TECHNICAL_OFFICE' : 'COSTIST_ESTIMATE';
  }

  async save(
    userId: string,
    structureId: string,
    deptId: string,
    periodId: string,
    body: UnitMovementInputBody,
    actor: TraceActor,
  ) {
    const ctx = await this.resolveContext(userId, structureId, deptId, periodId);

    // LA EXISTENCIA INICIAL NO ES UN DATO DE ESTE FORMULARIO.
    //
    // Las unidades que arrancan el mes, su grado de avance y su costo NO los
    // carga el costista: los escribe el arrastre desde el período anterior
    // (B18). Este guardado es del cuadro de movimiento del mes, y si el cliente
    // no manda esos campos hay que CONSERVAR los que ya están.
    //
    // El bug que esto arregla: los importes ya se conservaban (`body.X`
    // undefined ⇒ Prisma no toca la columna), pero las UNIDADES se reescribían
    // siempre desde el body. Un guardado sin `initialWip` dejaba la existencia
    // inicial en 0 CONSERVANDO su plata: quedaban los pesos sin las unidades que
    // los justifican, y el costo unitario se inflaba —11% en el caso probado—
    // porque el mismo costo se repartía entre menos unidades.
    //
    // Lo peor era que el informe seguía cuadrando: el error es coherente consigo
    // mismo, así que la verificación de "cuadra / no cuadra" no lo veía y alguien
    // que revisara el informe lo daba por bueno.
    const existente = await this.db.unitMovementSchedule.findUnique({
      where: { departmentId_periodId: { departmentId: deptId, periodId } },
      select: {
        initialWip: true,
        initialWipMpAvance: true,
        initialWipConvAvance: true,
      },
    });

    const conArrastre: UnitMovementInputBody = {
      ...body,
      initialWip: body.initialWip ?? (existente ? Number(existente.initialWip) : undefined),
      initialWipMpAvance:
        body.initialWipMpAvance ??
        (existente?.initialWipMpAvance == null ? undefined : Number(existente.initialWipMpAvance)),
      initialWipConvAvance:
        body.initialWipConvAvance ??
        (existente?.initialWipConvAvance == null ? undefined : Number(existente.initialWipConvAvance)),
    };

    // 1) Validación de dominio ANTES de escribir: si el cuadro no cuadra o pide
    //    derivar dos incógnitas, sale un 422 y no se toca la base.
    const resolved = this.resolve(ctx, this.bodyValues(conArrastre));

    return withTenant(userId, async (tx) => {
      const prev = await tx.unitMovementSchedule.findUnique({
        where: { departmentId_periodId: { departmentId: deptId, periodId } },
        select: { id: true },
      });

      // PROCEDENCIA DEL RECUENTO (D7). Solo se anota cuando este guardado trae
      // grados de avance de la existencia final: son el dato que, según la
      // cátedra, informa la oficina técnica y el área de costos "recibe y
      // aplica, no estima". Un guardado que solo toca unidades o costos no es un
      // recuento y no debe pisar la procedencia del que sí lo fue.
      const traeAvances =
        body.finalWipMpAvance !== undefined || body.finalWipConvAvance !== undefined;
      const procedencia = traeAvances
        ? {
            countSource: await this.countSourceFor(userId, actor),
            countedAt: new Date(),
            countedBy: actor.id,
          }
        : {};

      const data = { ...this.scheduleData(resolved, conArrastre), ...procedencia };
      const saved = await tx.unitMovementSchedule.upsert({
        where: { departmentId_periodId: { departmentId: deptId, periodId } },
        create: { departmentId: deptId, periodId, ...data },
        update: data,
      });

      await recordTraceAudit(
        {
          entityType: 'UnitMovementSchedule',
          entityId: saved.id,
          action: prev ? 'actualizar' : 'crear',
          actor,
          after: this.serialize(resolved),
        },
        tx,
      );

      // 2) Trazabilidad: un DataPoint por cada valor MANUAL provisto. El valor
      //    derivado por diferencia (el que el usuario NO cargó) queda afuera.
      const trazables: TraceableField[] = [...CUADRO_FIELDS, ...COST_FIELDS];
      for (const field of trazables) {
        const raw = body[field];
        if (raw === undefined) continue; // no ingresado a mano → no es DataPoint
        await this.traceValue(tx, ctx, field, raw, body, actor);
      }

      return {
        department: ctx.department.name,
        period: ctx.period.label,
        saved: this.serializeRow(saved),
        resolved: this.serialize(resolved),
      };
    });
  }

  /**
   * Deriva la producción equivalente (B07) del cuadro guardado. Si todavía no
   * hay cuadro, un 422 accionable (nombrando el departamento) en vez de un 500.
   */
  async getEquivalentProduction(userId: string, structureId: string, deptId: string, periodId: string) {
    const ctx = await this.resolveContext(userId, structureId, deptId, periodId);
    const row = await this.db.unitMovementSchedule.findUnique({
      where: { departmentId_periodId: { departmentId: deptId, periodId } },
    });
    if (!row) {
      throw new UnprocessableEntityError(
        `Todavía no cargaste el cuadro de movimiento de unidades del departamento «${ctx.department.name}» ` +
          `para el período «${ctx.period.label}». Cargalo primero para derivar la producción equivalente.`,
      );
    }

    const schedule = this.resolve(ctx, this.rowValues(row));
    const mpAvance = row.finalWipMpAvance != null ? Number(row.finalWipMpAvance) : 1;
    // La tabla persiste UN solo avance de conversión (`finalWipConvAvance`); si
    // el departamento sigue MOD y CIP por separado, ambos usan ese avance común.
    // Sin avance cargado, la EF aporta 0 a la conversión (default explícito).
    const convAvance = row.finalWipConvAvance != null ? Number(row.finalWipConvAvance) : 0;

    const peInput: EquivalentProductionInput = ctx.department.defaultConversionAvanceEqualsMO
      ? { schedule, mpAvance, conversionUnified: true, conversionAvance: convAvance }
      : { schedule, mpAvance, conversionUnified: false, modAvance: convAvance, cipAvance: convAvance };

    let pe;
    try {
      pe = calcEquivalentProduction(peInput);
    } catch (e) {
      throw this.nameDepartment(e, ctx.department.name);
    }

    return {
      department: ctx.department.name,
      period: ctx.period.label,
      unitsAtFullCompletion: pe.unitsAtFullCompletion.toNumber(),
      columns: pe.columns.map((c) => ({
        element: c.element,
        label: c.label,
        finalWipAvance: c.finalWipAvance.toNumber(),
        equivalentUnits: c.equivalentUnits.toNumber(),
      })),
    };
  }

  // --------------------------------------------------------------------------
  // Internos
  // --------------------------------------------------------------------------

  /** Propiedad (tenant) + que la estructura sea de Procesos + depto./período válidos. */
  private async resolveContext(
    userId: string,
    structureId: string,
    deptId: string,
    periodId: string,
  ): Promise<ProcessContext> {
    const structure = await this.db.costStructure.findFirst({ where: { id: structureId, userId, deletedAt: null } });
    if (!structure) throw new NotFoundError('Estructura de costos no encontrada');
    if (structure.costingSystem !== 'PROCESSES') {
      throw new UnprocessableEntityError(
        `La estructura «${structure.productName}» usa Costeo por Órdenes; el cuadro de movimiento de ` +
          'unidades solo aplica a estructuras de Costeo por Procesos.',
      );
    }

    const department = await this.db.processDepartment.findFirst({
      where: { id: deptId, structureId, deletedAt: null },
    });
    if (!department) throw new NotFoundError('Departamento de proceso no encontrado');

    const period = await this.db.costPeriod.findFirst({ where: { id: periodId, structureId } });
    if (!period) throw new NotFoundError('Período de costos no encontrado');

    return {
      structure: { id: structure.id, productName: structure.productName },
      department: {
        id: department.id,
        name: department.name,
        sequence: department.sequence,
        defaultConversionAvanceEqualsMO: department.defaultConversionAvanceEqualsMO,
      },
      period: { id: period.id, label: period.label, code: period.code },
    };
  }

  /** Corre el dominio; si lanza `ProcessValidationError`, la re-emite nombrando el departamento. */
  private resolve(ctx: ProcessContext, values: NumericValues): UnitMovementSchedule {
    try {
      return buildUnitMovementSchedule({ sequence: ctx.department.sequence, ...values });
    } catch (e) {
      throw this.nameDepartment(e, ctx.department.name);
    }
  }

  /** Antepone el nombre del departamento al mensaje del dominio (regla: nunca un id). */
  private nameDepartment(e: unknown, name: string): unknown {
    if (e instanceof ProcessValidationError) {
      return new ProcessValidationError(
        `Departamento «${name}»: ${e.message}`,
        e.details as Record<string, unknown> | undefined,
      );
    }
    return e;
  }

  /** Persiste UN valor manual del cuadro como DataPoint trazable (crea o versiona). */
  private async traceValue(
    tx: Prisma.TransactionClient,
    ctx: ProcessContext,
    field: TraceableField,
    raw: number,
    body: UnitMovementInputBody,
    actor: TraceActor,
  ): Promise<void> {
    const meta: { label: string; unit: string; element: 'MP' | 'MOD' | 'CIP' } =
      field in COST_META ? COST_META[field as CostField] : FIELD_META[field as CuadroField];
    const fieldKey = this.fieldKey(ctx, field);
    const label = `${meta.label} · ${ctx.department.name}, ${ctx.period.label}`;
    const valueJson = {
      scope: 'unit-movement',
      field,
      departmentId: ctx.department.id,
      periodId: ctx.period.id,
    };

    const existing = await tx.dataPoint.findFirst({
      where: { structureId: ctx.structure.id, fieldKey },
      include: { versions: { orderBy: { versionN: 'desc' }, take: 1 } },
    });

    if (!existing) {
      await this.dataPoints.createInTx(
        tx,
        ctx.structure.id,
        {
          element: meta.element,
          fieldKey,
          label,
          unit: meta.unit,
          // EL DATO DEL CUADRO YA SABE DE QUÉ PERÍODO ES.
          //
          // La imputación existe para los datos que llegan por ingesta: una
          // factura no dice a qué mes de costeo pertenece. Un valor del cuadro
          // de movimiento, sí — se carga PARA un período concreto, y el propio
          // `fieldKey` lo lleva adentro.
          //
          // Sin esto, cada guardado del cuadro dejaba 6 datos sin imputar por
          // departamento, y el cierre del período los bloquea a todos: con dos
          // departamentos ya eran 12 fichas que el costista tenía que imputar a
          // mano, una por una, para poder cerrar el mes. En la práctica, el
          // período no se podía cerrar.
          periodoImputado: ctx.period.code,
          sourceArea: body.sourceArea,
          method: body.method,
          valueNum: raw,
          valueJson,
        },
        actor,
      );
      return;
    }

    // Sin cambio de valor ⇒ no versionamos (no dejamos versiones espurias).
    const lastValue = existing.versions[0]?.valueNum;
    if (lastValue != null && Number(lastValue) === raw) return;

    await this.dataPoints.addVersionInTx(
      tx,
      existing.id,
      { fechaHecho: existing.fechaHecho },
      {
        sourceArea: body.sourceArea,
        method: body.method,
        valueNum: raw,
        valueJson,
        reason: 'Actualización del cuadro de movimiento de unidades',
      },
      actor,
    );
  }

  /** Clave estable de un valor del cuadro (única por estructura+depto+período+campo). */
  private fieldKey(ctx: ProcessContext, field: TraceableField): string {
    return `proceso.cuadro.${ctx.period.id}.${ctx.department.id}.${field}`;
  }

  /** dataPointId por campo trazable (null si es derivado o no se cargó). */
  private async tracesFor(ctx: ProcessContext): Promise<Record<TraceableField, string | null>> {
    const campos: TraceableField[] = [...CUADRO_FIELDS, ...COST_FIELDS];
    const keys = campos.map((f) => this.fieldKey(ctx, f));
    const dps = await this.db.dataPoint.findMany({
      where: { structureId: ctx.structure.id, fieldKey: { in: keys }, voidedAt: null },
      select: { id: true, fieldKey: true },
    });
    const byKey = new Map(dps.map((d) => [d.fieldKey, d.id]));
    const out = this.emptyTraces();
    for (const field of campos) {
      out[field] = byKey.get(this.fieldKey(ctx, field)) ?? null;
    }
    return out;
  }

  private emptyTraces(): Record<TraceableField, string | null> {
    return Object.fromEntries(
      [...CUADRO_FIELDS, ...COST_FIELDS].map((f) => [f, null]),
    ) as Record<TraceableField, string | null>;
  }

  private bodyValues(body: UnitMovementInputBody): NumericValues {
    return {
      initialWip: body.initialWip,
      startedInProduction: body.startedInProduction,
      receivedFromPrevious: body.receivedFromPrevious,
      unitIncrease: body.unitIncrease,
      transferredOut: body.transferredOut,
      finishedInStock: body.finishedInStock,
      normalLossPct: body.normalLossPct,
      totalLossReported: body.totalLossReported,
      finalWip: body.finalWip,
    };
  }

  private rowValues(row: Record<string, unknown>): NumericValues {
    const n = (x: unknown): number | undefined => (x == null ? undefined : Number(x));
    return {
      initialWip: n(row.initialWip),
      startedInProduction: n(row.startedInProduction),
      receivedFromPrevious: n(row.receivedFromPrevious),
      unitIncrease: n(row.unitIncrease),
      transferredOut: n(row.transferredOut),
      finishedInStock: n(row.finishedInStock),
      normalLossPct: n(row.normalLossPct),
      totalLossReported: n(row.totalLossReported),
      finalWip: n(row.finalWip),
    };
  }

  /** Fila a persistir: unidades RESUELTAS (incluye la derivada) + avances del body. */
  private scheduleData(resolved: UnitMovementSchedule, body: UnitMovementInputBody) {
    return {
      initialWip: resolved.initialWip.toNumber(),
      startedInProduction: resolved.startedInProduction.toNumber(),
      receivedFromPrevious: resolved.receivedFromPrevious.toNumber(),
      unitIncrease: resolved.unitIncrease.toNumber(),
      transferredOut: resolved.transferredOut.toNumber(),
      finishedInStock: resolved.finishedInStock.toNumber(),
      normalLossPct: body.normalLossPct ?? null,
      normalLoss: resolved.normalLoss.toNumber(),
      totalLossReported: body.totalLossReported ?? null,
      extraordinaryLoss: resolved.extraordinaryLoss.toNumber(),
      finalWip: resolved.finalWip.toNumber(),
      finalWipMpAvance: body.finalWipMpAvance ?? null,
      finalWipConvAvance: body.finalWipConvAvance ?? null,
      initialWipMpAvance: body.initialWipMpAvance ?? null,
      initialWipConvAvance: body.initialWipConvAvance ?? null,
      // Importes por elemento. `undefined` = el cliente no mandó el campo ⇒ se
      // deja como está (Prisma ignora `undefined` en el update). No se pisa con
      // null: el arrastre entre períodos (B18) escribe los costos de la EI, y un
      // guardado del cuadro de unidades no tiene por qué borrarlos.
      periodCostMp: body.periodCostMp,
      periodCostMo: body.periodCostMo,
      periodCostCif: body.periodCostCif,
      initialWipCostMp: body.initialWipCostMp,
      initialWipCostMo: body.initialWipCostMo,
      initialWipCostCif: body.initialWipCostCif,
    };
  }

  private serialize(s: UnitMovementSchedule) {
    return {
      initialWip: s.initialWip.toNumber(),
      startedInProduction: s.startedInProduction.toNumber(),
      receivedFromPrevious: s.receivedFromPrevious.toNumber(),
      unitIncrease: s.unitIncrease.toNumber(),
      periodUnits: s.periodUnits.toNumber(),
      transferredOut: s.transferredOut.toNumber(),
      finishedInStock: s.finishedInStock.toNumber(),
      normalLoss: s.normalLoss.toNumber(),
      extraordinaryLoss: s.extraordinaryLoss.toNumber(),
      finalWip: s.finalWip.toNumber(),
      totalToAccount: s.totalToAccount.toNumber(),
      totalAccounted: s.totalAccounted.toNumber(),
      cuadra: s.totalToAccount.equals(s.totalAccounted),
    };
  }

  private serializeRow(row: Record<string, unknown>) {
    const n = (x: unknown): number | null => (x == null ? null : Number(x));
    return {
      initialWip: n(row.initialWip),
      startedInProduction: n(row.startedInProduction),
      receivedFromPrevious: n(row.receivedFromPrevious),
      unitIncrease: n(row.unitIncrease),
      transferredOut: n(row.transferredOut),
      finishedInStock: n(row.finishedInStock),
      normalLossPct: n(row.normalLossPct),
      normalLoss: n(row.normalLoss),
      totalLossReported: n(row.totalLossReported),
      extraordinaryLoss: n(row.extraordinaryLoss),
      finalWip: n(row.finalWip),
      finalWipMpAvance: n(row.finalWipMpAvance),
      finalWipConvAvance: n(row.finalWipConvAvance),
      initialWipMpAvance: n(row.initialWipMpAvance),
      initialWipConvAvance: n(row.initialWipConvAvance),
      periodCostMp: n(row.periodCostMp),
      periodCostMo: n(row.periodCostMo),
      periodCostCif: n(row.periodCostCif),
      initialWipCostMp: n(row.initialWipCostMp),
      initialWipCostMo: n(row.initialWipCostMo),
      initialWipCostCif: n(row.initialWipCostCif),
      // Solo lectura: lo escribe la apertura del período siguiente (B18), no el
      // costista. Viaja igual para que la pantalla pueda mostrar de dónde sale
      // el costo del departamento anterior contenido en la existencia inicial.
      initialWipCostPrevDept: n(row.initialWipCostPrevDept),
    };
  }
}
