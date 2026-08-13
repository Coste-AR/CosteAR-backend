import type { PrismaClient, Prisma } from '@prisma/client';
import { prisma, withTenant } from '../../infrastructure/database/prisma.js';
import { recordTraceAudit, type TraceActor } from '../audit/trace-audit.js';
import { NotFoundError } from '../../domain/errors/domain-error.js';
import { fmtMoney, fmtNumber } from './format.js';
import { LateDataService } from '../cost-structures/late-data-service.js';
import type {
  CreateDataPointInput,
  AddVersionInput,
} from '../../shared/schemas/trazabilidad.schema.js';
import { MP_MOVEMENT_FIELD_KEYS } from './orders-input-points.js';

/**
 * Servicio de Trazabilidad Total v1 (spec secciones A y C).
 *
 * Toda mutación corre dentro de una única transacción de DB (`withTenant`,
 * que además setea el tenant para RLS) y escribe su entrada en
 * `trace_audit_log` en esa misma transacción (R2). Ningún dato se pisa: las
 * correcciones siempre insertan una versión nueva (R1).
 */
export class DataPointService {
  constructor(
    private readonly db: PrismaClient = prisma,
    private readonly lateData: LateDataService = new LateDataService(db),
  ) {}

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

    // IDEMPOTENCIA DE LOS MOVIMIENTOS DE MP.
    //
    // Desde que el guardado de la sección reconcilia sus propios data points
    // (`datapoint-reconciler`), el formulario de MP llega SEGUNDO: guarda la
    // sección y recién después postea los movimientos nuevos para encolar su
    // imputación. Sin esto, cada movimiento nacería dos veces —una por el
    // backend y otra por el formulario— y la ficha PPP mostraría el doble de
    // compras que la planilla.
    //
    // Se devuelve el dato que ya existe (mismo movimiento: misma etiqueta,
    // misma fecha, mismo rol), así el formulario sigue recibiendo un id con el
    // que imputar y la UX de imputación queda intacta.
    const yaExiste = await this.findMpMovementPoint(structureId, input);
    if (yaExiste) return yaExiste;

    return withTenant(userId, (tx) => this.createInTx(tx, structureId, input, actor));
  }

  /**
   * Data point de un movimiento de MP ya registrado, si lo hay. Identidad del
   * movimiento = (fieldKey, etiqueta, fecha del hecho, rol) — la misma tripleta
   * (tipo, detalle, fecha) que usa el formulario para reconocer un movimiento
   * guardado, más el rol que distingue cantidad de precio.
   */
  private async findMpMovementPoint(structureId: string, input: CreateDataPointInput) {
    if (!MP_MOVEMENT_FIELD_KEYS.includes(input.fieldKey)) return null;
    const role =
      (input.valueJson as Record<string, unknown> | undefined)?.role ??
      (input.fieldKey.endsWith('.precio') ? 'precio' : 'cantidad');

    const candidates = await this.db.dataPoint.findMany({
      where: {
        structureId,
        fieldKey: input.fieldKey,
        label: input.label,
        fechaHecho: input.fechaHecho ? new Date(input.fechaHecho) : null,
        voidedAt: null,
      },
      include: { versions: { orderBy: { versionN: 'desc' }, take: 1 } },
      orderBy: { createdAt: 'asc' },
    });

    return (
      candidates.find((dp) => {
        const json = dp.versions[0]?.valueJson as Record<string, unknown> | null;
        const dpRole = json?.role ?? (dp.fieldKey.endsWith('.precio') ? 'precio' : 'cantidad');
        return dpRole === role;
      }) ?? null
    );
  }

  /**
   * Anulado lógico dentro de una transacción YA abierta (misma semántica que
   * `void`: nunca DELETE, R1). Lo usa el reconciliador cuando un insumo
   * desaparece de la sección guardada.
   */
  async voidInTx(tx: Prisma.TransactionClient, id: string, actor: TraceActor, comment: string) {
    const updated = await tx.dataPoint.update({
      where: { id },
      data: { voidedAt: new Date(), status: 'anulado' },
    });
    await recordTraceAudit(
      { entityType: 'DataPoint', entityId: id, action: 'anular', actor, comment },
      tx,
    );
    return updated;
  }

  /**
   * Igual que `create`, pero dentro de una transacción YA abierta por el
   * llamador, para componer la creación de un DataPoint con otras escrituras
   * (p. ej. el cuadro de movimiento de unidades, B15) en UNA sola transacción
   * atómica. El chequeo de propiedad de la estructura queda a cargo del
   * llamador (que ya lo hizo antes de abrir la transacción). Fuente ÚNICA de
   * la creación de un dato trazable: `create` delega acá.
   */
  async createInTx(
    tx: Prisma.TransactionClient,
    structureId: string,
    /**
     * `periodoImputado` es opcional y solo lo manda quien SABE a qué período
     * pertenece el dato en el momento de crearlo. Un comprobante que entra por
     * ingesta no lo sabe —de ahí toda la maquinaria de imputación—, pero un
     * valor del cuadro de movimiento sí: se carga PARA un período concreto.
     */
    input: CreateDataPointInput & { periodoImputado?: string },
    actor: TraceActor,
  ) {
    const dp = await tx.dataPoint.create({
      data: {
        structureId,
        element: input.element,
        fieldKey: input.fieldKey,
        label: input.label,
        unit: input.unit,
        sourceArea: input.sourceArea,
        periodoImputado: input.periodoImputado ?? null,
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
  }

  /**
   * Agrega una corrección. NUNCA pisa la versión anterior: inserta version_n+1
   * con `reason` obligatorio. Si el dato ya estaba validado/aplicado, vuelve a
   * 'borrador' — una corrección invalida la firma anterior y pide re-validar.
   */
  async addVersion(userId: string, id: string, input: AddVersionInput, actor: TraceActor) {
    const dp = await this.requireDataPoint(userId, id);
    return withTenant(userId, (tx) => this.addVersionInTx(tx, id, dp, input, actor));
  }

  /**
   * Igual que `addVersion`, pero dentro de una transacción YA abierta por el
   * llamador (misma lógica de composición que `createInTx`). `existing` es el
   * DataPoint ya resuelto por el llamador (propiedad chequeada). Fuente ÚNICA
   * de la corrección de un dato: `addVersion` delega acá.
   */
  async addVersionInTx(
    tx: Prisma.TransactionClient,
    id: string,
    existing: { fechaHecho: Date | null },
    input: AddVersionInput,
    actor: TraceActor,
  ) {
    const dp = existing;
    const last = await tx.dataPointVersion.findFirst({
      where: { dataPointId: id },
      orderBy: { versionN: 'desc' },
    });
    const nextN = (last?.versionN ?? 0) + 1;

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

    // ¿El período al que lo están mandando ya está cerrado? Si sí, esto no es
    // una imputación más: es plata que entra a un mes que alguien ya dio por
    // bueno. La decisión no la toma este método — se registra el conflicto y se
    // aplica la política de la estructura, que puede ser preguntar.
    if (await this.lateData.isClosed(dp.structureId, periodo)) {
      const outcome = await this.lateData.handle(userId, id, dp.structureId, periodo, {
        ...actor,
        area: sourceArea,
      });
      // Si quedó pendiente, el dato NO se imputa: sigue fuera de todo cálculo
      // hasta que alguien decida.
      if (outcome.pendiente) return { ...dp, lateData: outcome };
      return { ...(await this.requireDataPoint(userId, id)), lateData: outcome };
    }

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
      // El final de la cadena, cuando existe: el papel. `counterparty` viaja
      // porque "Factura A 0001-00012345" sin decir de quién no le sirve a nadie
      // que audite (T-04).
      evidence: current?.evidence
        ? {
            kind: current.evidence.kind,
            reference: current.evidence.reference,
            counterparty: current.evidence.counterparty,
            fileUrl: current.evidence.fileUrl,
          }
        : null,
      versions: versions.map((v) => ({
        n: v.versionN,
        current: v.versionN === current?.versionN,
        display: v.valueNum !== null ? fmtNumber(Number(v.valueNum)) : JSON.stringify(v.valueJson),
        reason: v.reason,
        by: v.createdByUser.name,
        at: v.createdAt.toISOString(),
      })),
      impacts: this.impactsFor(dp.element, dp.fieldKey),
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

  /**
   * En qué otros números repercute este dato si cambia.
   *
   * Depende del SISTEMA DE COSTEO, no solo del elemento. Un dato del cuadro de
   * movimiento no impacta en el PPP ni en el COGS: impacta en la producción
   * equivalente, en el costo unitario del departamento y —vía el costo
   * transferido— en todas las etapas siguientes. Mostrarle a un costista de
   * Procesos los impactos de Órdenes es decirle algo falso sobre su propio
   * número.
   *
   * Se distingue por la `fieldKey`, que en Procesos arranca con `proceso.cuadro.`
   * (la arma `unit-movement-service`). Órdenes no la usa, así que su
   * comportamiento no cambia.
   */
  private impactsFor(element: string, fieldKey?: string | null): string[] {
    if (fieldKey?.startsWith('proceso.cuadro.')) {
      return this.processImpactsFor(fieldKey);
    }
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

  /**
   * Impactos de un dato del cuadro de movimiento (Costeo por Procesos).
   *
   * La `fieldKey` es `proceso.cuadro.{periodId}.{deptId}.{campo}`: el último
   * segmento dice qué se cargó.
   */
  private processImpactsFor(fieldKey: string): string[] {
    const campo = fieldKey.split('.').pop() ?? '';

    // Cadena común: todo dato del cuadro termina moviendo el costo del producto
    // terminado, porque el costo de cada etapa se transfiere a la siguiente.
    const cadena = ['Costo unitario del departamento', 'Costo del producto terminado'];

    switch (campo) {
      case 'initialWip':
      case 'startedInProduction':
      case 'receivedFromPrevious':
      case 'unitIncrease':
        return ['Total de unidades a justificar', 'Producción equivalente', ...cadena];

      case 'transferredOut':
        return [
          'Unidades justificadas',
          'Producción equivalente',
          'Costo transferido a la etapa siguiente',
          ...cadena,
        ];

      case 'finishedInStock':
        return ['Unidades justificadas', 'Producción equivalente', ...cadena];

      case 'finalWip':
        return [
          'Unidades justificadas',
          'Producción equivalente',
          'Valuación de la existencia final',
          'Existencia inicial del período siguiente',
          ...cadena,
        ];

      case 'normalLossPct':
        return [
          'Pérdida normal del período',
          'CAUP — costo adicional por unidades perdidas',
          ...cadena,
        ];

      case 'totalLossReported':
        return [
          'Pérdida extraordinaria del período',
          'Producción equivalente',
          'Resultado del período (las extraordinarias no las absorbe el producto)',
          ...cadena,
        ];

      case 'periodCostMp':
      case 'periodCostMo':
      case 'periodCostCif':
        return ['Costo del período del departamento', 'Costo acumulado a justificar', ...cadena];

      case 'initialWipCostMp':
      case 'initialWipCostMo':
      case 'initialWipCostCif':
        return [
          'Costo de la existencia inicial en proceso',
          'Costo acumulado a justificar',
          ...cadena,
        ];

      default:
        return ['Producción equivalente', ...cadena];
    }
  }

  /**
   * F06 — Movimientos de MP (compras/consumos) tal como viven en el store de
   * trazabilidad, agrupados por `movementId`, INCLUYENDO los que todavía no
   * tienen decisión de imputación (`periodoImputado = null`).
   *
   * La ficha PPP se dibujaba SOLO con el JSON de la sección (`rawMaterialConfig`),
   * que no sabe nada de imputación: un movimiento sin imputar quedaba sin marca
   * (o directamente invisible si el JSON y los data points se desincronizaban),
   * aunque el motor lo contara como "dato sin imputar" (F04). Esta lista es la
   * fuente de verdad del estado de imputación para que la ficha marque cada
   * pendiente y lo haga accionable, sin ocultar ninguno.
   *
   * NO filtra por período: mostrar TODOS es justamente el fix. Un movimiento es
   * `pending` si alguno de sus data points hermanos sigue sin imputar (cantidad
   * y precio se imputan juntos, así que en la práctica es todo-o-nada).
   */
  async listMpMovements(userId: string, structureId: string) {
    await this.requireStructureOwned(userId, structureId);

    const points = await this.db.dataPoint.findMany({
      where: {
        structureId,
        element: 'MP',
        fieldKey: { in: ['mp.compra.cantidad', 'mp.compra.precio', 'mp.consumo.cantidad'] },
        voidedAt: null,
        status: { not: 'anulado' },
      },
      include: { versions: { orderBy: { versionN: 'desc' }, take: 1 } },
      orderBy: { createdAt: 'asc' },
    });

    type MpMovement = {
      movementId: string;
      label: string;
      detail: string;
      type: 'purchase' | 'consumption';
      fechaHecho: string | null;
      // fecha_captación (§3): timestamp que puso el servidor al entrar el dato.
      // Read-only, nunca del reloj del cliente. Siempre presente (default now()).
      fechaCaptacion: string;
      periodoImputado: string | null;
      pending: boolean;
      dataPointIds: string[];
    };
    const byMovement = new Map<string, MpMovement>();

    for (const dp of points) {
      const vJson = (dp.versions[0]?.valueJson ?? null) as Record<string, unknown> | null;
      const movementId = vJson?.movementId as string | undefined;
      // Solo movimientos reales: la config migrada (mp.config) no lleva movementId.
      if (!movementId) continue;

      const type: 'purchase' | 'consumption' = dp.fieldKey.startsWith('mp.compra')
        ? 'purchase'
        : 'consumption';
      const fechaHecho = dp.fechaHecho ? dp.fechaHecho.toISOString().slice(0, 10) : null;
      const fechaCaptacion = dp.fechaCaptacion.toISOString();

      const existing = byMovement.get(movementId);
      if (existing) {
        existing.dataPointIds.push(dp.id);
        // Los hermanos de un movimiento (cantidad + precio) se crean juntos;
        // como captación es la que puso el servidor, tomamos la más temprana
        // para representar "cuándo entró el movimiento al sistema".
        if (fechaCaptacion < existing.fechaCaptacion) existing.fechaCaptacion = fechaCaptacion;
        if (dp.periodoImputado === null) {
          existing.pending = true;
          existing.periodoImputado = null;
        }
      } else {
        byMovement.set(movementId, {
          movementId,
          label: dp.label,
          detail: this.stripMovementPrefix(dp.label),
          type,
          fechaHecho,
          fechaCaptacion,
          periodoImputado: dp.periodoImputado,
          pending: dp.periodoImputado === null,
          dataPointIds: [dp.id],
        });
      }
    }

    return Array.from(byMovement.values());
  }

  /** 'Compra — Factura A-1' → 'Factura A-1' (mismo detalle que la fila de la sección). */
  private stripMovementPrefix(label: string): string {
    return label.replace(/^(Compra|Consumo)\s+—\s+/, '');
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
      latencyByArea: await this.getCaptureLatency(structureId),
    };
  }

  /**
   * Latencia de captación = fecha_captación − fecha_hecho, promedio en días
   * por área (spec F4). Solo considera data points con `fechaHecho` cargado
   * (si no se sabe cuándo pasó el hecho, no hay latencia que medir).
   */
  private async getCaptureLatency(structureId: string): Promise<Array<{ area: string; avgDays: number; count: number }>> {
    const points = await this.db.dataPoint.findMany({
      where: { structureId, fechaHecho: { not: null } },
      select: { sourceArea: true, fechaHecho: true, fechaCaptacion: true },
    });

    const byArea = new Map<string, { totalDays: number; count: number }>();
    for (const p of points) {
      if (!p.fechaHecho) continue;
      const days = (p.fechaCaptacion.getTime() - p.fechaHecho.getTime()) / (1000 * 60 * 60 * 24);
      const bucket = byArea.get(p.sourceArea) ?? { totalDays: 0, count: 0 };
      bucket.totalDays += days;
      bucket.count += 1;
      byArea.set(p.sourceArea, bucket);
    }

    return Array.from(byArea.entries()).map(([area, { totalDays, count }]) => ({
      area,
      avgDays: Math.round((totalDays / count) * 100) / 100,
      count,
    }));
  }
}
