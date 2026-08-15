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

/**
 * GRADOS DE AVANCE — DATOS CARGADOS A MANO, CON FICHA (T-11).
 *
 * Se guardaban en la fila del cuadro y no generaban NINGÚN `DataPoint`: eran los
 * únicos valores que una persona escribe en esta pantalla y que no dejaban
 * rastro de quién los escribió ni cuándo.
 *
 * No son un detalle de presentación: la producción equivalente es
 * "terminadas + existencia final × grado de avance", así que estos cuatro
 * números mueven el denominador del costo unitario de cada elemento. Un informe
 * donde el costo unitario se puede abrir hasta el fondo pero el avance que lo
 * determinó no tiene ficha es un informe que promete trazabilidad y la corta
 * justo en el dato más discutible del mes — el que informa la oficina técnica y
 * el que el costista estima cuando planta no contesta (ver `countSourceFor`).
 *
 * Van con el MISMO prefijo de clave que el resto del cuadro: para la
 * trazabilidad son datos del cuadro, no una familia nueva.
 */
const AVANCE_FIELDS = [
  'finalWipMpAvance',
  'finalWipConvAvance',
  'initialWipMpAvance',
  'initialWipConvAvance',
] as const;
type AvanceField = (typeof AVANCE_FIELDS)[number];

type TraceableField = CuadroField | CostField | AvanceField;

const COST_META: Record<CostField, { label: string; unit: string; element: 'MP' | 'MOD' | 'CIP' }> = {
  periodCostMp: { label: 'Costo de materia prima del período', unit: '$', element: 'MP' },
  periodCostMo: { label: 'Costo de mano de obra del período', unit: '$', element: 'MOD' },
  periodCostCif: { label: 'Carga fabril del período', unit: '$', element: 'CIP' },
  initialWipCostMp: { label: 'Materia prima de la existencia inicial', unit: '$', element: 'MP' },
  initialWipCostMo: { label: 'Mano de obra de la existencia inicial', unit: '$', element: 'MOD' },
  initialWipCostCif: { label: 'Carga fabril de la existencia inicial', unit: '$', element: 'CIP' },
};

/**
 * Los avances viajan como FRACCIÓN (0,80 = 80 %) en toda la aplicación, y acá se
 * guardan tal cual se recibieron: la ficha muestra el mismo número que tiene la
 * columna del cuadro, sin conversiones intermedias. La unidad es '%' por la
 * misma razón que en `normalLossPct`, que ya se guardaba así.
 *
 * `element`: MP para el avance de materia prima. El de conversión se anota en
 * MOD porque el enum no tiene una opción "conversión" y la conversión es
 * MOD + CIP: MOD es el hogar estable de ese par (mismo criterio con el que las
 * unidades del cuadro viven en MP).
 */
const AVANCE_META: Record<AvanceField, { label: string; unit: string; element: 'MP' | 'MOD' }> = {
  finalWipMpAvance: {
    label: 'Grado de avance de la existencia final en materia prima',
    unit: '%',
    element: 'MP',
  },
  finalWipConvAvance: {
    label: 'Grado de avance de la existencia final en conversión',
    unit: '%',
    element: 'MOD',
  },
  initialWipMpAvance: {
    label: 'Grado de avance de la existencia inicial en materia prima',
    unit: '%',
    element: 'MP',
  },
  initialWipConvAvance: {
    label: 'Grado de avance de la existencia inicial en conversión',
    unit: '%',
    element: 'MOD',
  },
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
        fechaHecho: null,
      };
    }

    // LECTURA, NO GUARDADO. `resolve()` aplica la validación de "cuadro
    // completo" (R1/R5 del dominio), pensada para GUARDAR. Un mes recién
    // abierto trae la existencia inicial que puso el arrastre (B18) pero
    // todavía no las salidas: faltan las dos incógnitas a la vez y el dominio
    // lanza `ProcessValidationError`. Antes esa excepción tumbaba el `GET`
    // entero con un 422, y la pantalla ni siquiera podía dibujar la existencia
    // inicial arrastrada (H9). Acá se devuelve lo que HAY (`saved`) con
    // `resolved: null`, y la pantalla lo muestra incompleto en vez de romperse.
    let resolved: UnitMovementSchedule | null = null;
    try {
      resolved = this.resolve(ctx, this.rowValues(row));
    } catch (e) {
      if (!(e instanceof ProcessValidationError)) throw e;
    }

    return {
      department: ctx.department.name,
      period: ctx.period.label,
      exists: true,
      saved: this.serializeRow(row, await this.countedByName(row.countedBy)),
      resolved: resolved ? this.serialize(resolved) : null,
      ...(await this.tracesFor(ctx)),
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
      const trazables: TraceableField[] = [...CUADRO_FIELDS, ...COST_FIELDS, ...AVANCE_FIELDS];
      for (const field of trazables) {
        const raw = body[field];
        if (raw === undefined) continue; // no ingresado a mano → no es DataPoint
        await this.traceValue(tx, ctx, field, raw, body, actor);
      }

      return {
        department: ctx.department.name,
        period: ctx.period.label,
        saved: this.serializeRow(saved, await this.countedByName(saved.countedBy, tx)),
        resolved: this.serialize(resolved),
      };
    }).then(async (out) => ({
      // Las fichas recién creadas viajan de vuelta con el guardado. La pantalla
      // las necesita en el mismo acto: para marcar los valores que acaban de
      // quedar trazables, y —si la fecha del hecho cae fuera del período— para
      // poder preguntar a qué período se imputan sin volver a consultar.
      ...out,
      ...(await this.tracesFor(ctx)),
    }));
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
      field in COST_META
        ? COST_META[field as CostField]
        : field in AVANCE_META
          ? AVANCE_META[field as AvanceField]
          : FIELD_META[field as CuadroField];
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
          //
          // La excepción es la fecha del hecho: si el costista declara que esto
          // pasó en OTRO mes, la imputación deja de ser obvia y no la decide el
          // servidor solo (manual §3). Ver `periodoImputadoFor`.
          periodoImputado: this.periodoImputadoFor(body.fechaHecho, ctx.period.code) ?? undefined,
          sourceArea: body.sourceArea,
          method: body.method,
          valueNum: raw,
          valueJson,
          fechaHecho: body.fechaHecho,
        },
        actor,
      );
      return;
    }

    // Sin cambio de valor NI de fecha ⇒ no versionamos (no dejamos versiones
    // espurias). La fecha entra en la comparación porque corregir cuándo pasó
    // un hecho ES una corrección del dato: cambia su imputación y tiene que
    // quedar firmada como cualquier otra.
    const lastValue = existing.versions[0]?.valueNum;
    const fechaPrevia = existing.fechaHecho ? existing.fechaHecho.toISOString().slice(0, 10) : null;
    const cambioValor = lastValue == null || Number(lastValue) !== raw;
    const cambioFecha = body.fechaHecho !== undefined && body.fechaHecho !== fechaPrevia;
    if (!cambioValor && !cambioFecha) return;

    await this.dataPoints.addVersionInTx(
      tx,
      existing.id,
      { fechaHecho: existing.fechaHecho },
      {
        sourceArea: body.sourceArea,
        method: body.method,
        valueNum: raw,
        valueJson,
        fechaHecho: body.fechaHecho,
        reason: cambioValor
          ? 'Actualización del cuadro de movimiento de unidades'
          : 'Corrección de la fecha del hecho del cuadro de movimiento de unidades',
      },
      actor,
    );
  }

  /**
   * A QUÉ PERÍODO SE IMPUTA UN DATO DEL CUADRO.
   *
   * Sin fecha del hecho —o con una fecha que cae DENTRO del período que se está
   * cargando— se imputa solo al período del cuadro: el dato se cargó para ese
   * mes y no hay nada que preguntar.
   *
   * Con una fecha de OTRO mes queda en `null`, o sea pendiente. No es un olvido:
   * es la misma regla de Órdenes (manual §3, `proposeImputation`). Un recuento
   * de producción fechado en junio que alguien carga en el cuadro de julio puede
   * ser un devengamiento legítimo o un error de tipeo, y el sistema no puede
   * elegir por el costista. La pantalla pregunta con `ImputacionModal` apenas
   * termina de guardar, y mientras tanto el resultado se marca incompleto (F04),
   * que es exactamente lo que corresponde.
   */
  private periodoImputadoFor(fechaHecho: string | undefined, periodCode: string): string | null {
    if (!fechaHecho) return periodCode;
    return fechaHecho.slice(0, 7) === periodCode ? periodCode : null;
  }

  /** Clave estable de un valor del cuadro (única por estructura+depto+período+campo). */
  private fieldKey(ctx: ProcessContext, field: TraceableField): string {
    return `proceso.cuadro.${ctx.period.id}.${ctx.department.id}.${field}`;
  }

  /**
   * `dataPointId` por campo trazable (null si es derivado o no se cargó) + la
   * fecha del hecho del cuadro.
   *
   * La fecha sale de las fichas y no de la fila del cuadro porque es un dato de
   * la CAPTURA, no del cálculo: todas las fichas del mismo (departamento,
   * período) se cargan en el mismo acto y comparten la fecha. Sin devolverla, la
   * ficha de cualquier valor del cuadro mostraba "Hecho: —" para siempre, y el
   * formulario no tenía con qué rellenar el campo al volver a abrirlo.
   */
  private async tracesFor(
    ctx: ProcessContext,
  ): Promise<{ traces: Record<TraceableField, string | null>; fechaHecho: string | null }> {
    const campos: TraceableField[] = [...CUADRO_FIELDS, ...COST_FIELDS, ...AVANCE_FIELDS];
    const keys = campos.map((f) => this.fieldKey(ctx, f));
    const dps = await this.db.dataPoint.findMany({
      where: { structureId: ctx.structure.id, fieldKey: { in: keys }, voidedAt: null },
      select: { id: true, fieldKey: true, fechaHecho: true },
    });
    const byKey = new Map(dps.map((d) => [d.fieldKey, d.id]));
    const traces = this.emptyTraces();
    for (const field of campos) {
      traces[field] = byKey.get(this.fieldKey(ctx, field)) ?? null;
    }
    const conFecha = dps.find((d) => d.fechaHecho != null);
    return {
      traces,
      fechaHecho: conFecha?.fechaHecho ? conFecha.fechaHecho.toISOString().slice(0, 10) : null,
    };
  }

  private emptyTraces(): Record<TraceableField, string | null> {
    return Object.fromEntries(
      [...CUADRO_FIELDS, ...COST_FIELDS, ...AVANCE_FIELDS].map((f) => [f, null]),
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

  /**
   * Nombre de quien informó el recuento. `null` si todavía no lo informó nadie
   * o si ese usuario ya no existe: la pantalla tiene que poder decir "no
   * consta" en vez de mostrar un uuid, que además nunca viaja en una traza que
   * después se muestra (mismo criterio que el resto del módulo).
   */
  private async countedByName(
    countedBy: unknown,
    client: Pick<PrismaClient, 'user'> = this.db,
  ): Promise<string | null> {
    if (typeof countedBy !== 'string') return null;
    const user = await client.user.findUnique({ where: { id: countedBy }, select: { name: true } });
    return user?.name ?? null;
  }

  private serializeRow(row: Record<string, unknown>, countedByName: string | null = null) {
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

      // PROCEDENCIA DEL RECUENTO (D7). El backend ya la guardaba desde que se
      // construyó `countSourceFor()`, pero no la devolvía ningún endpoint: el
      // asistente de setup le promete al cliente que la diferencia entre "lo
      // informó la planta" y "lo estimó el área de costos" se ve en la
      // trazabilidad, y hasta acá no se veía en ningún lado.
      //
      // `NOT_COUNTED` (el default de la columna) no es un hueco: es el estado
      // real de un mes recién abierto por el arrastre, cuya existencia FINAL
      // todavía no contó nadie. Mostrarlo es justamente lo que distingue ese
      // mes de uno con recuento hecho.
      countSource: typeof row.countSource === 'string' ? row.countSource : null,
      countedAt: row.countedAt instanceof Date ? row.countedAt.toISOString() : null,
      countedByName,
    };
  }
}
