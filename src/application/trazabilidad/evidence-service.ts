import type { PrismaClient, Prisma } from '@prisma/client';
import { prisma, withTenant } from '../../infrastructure/database/prisma.js';
import { recordTraceAudit, type TraceActor } from '../audit/trace-audit.js';
import { NotFoundError, ValidationError } from '../../domain/errors/domain-error.js';
import { uploadToCloudinary } from '../../infrastructure/cloudinary/cloudinary-upload.js';
import { DataPointService } from './data-point-service.js';
import type {
  EvidenceInput,
  AttachEvidenceInput,
  EvidenceKind,
} from '../../shared/schemas/trazabilidad.schema.js';

/**
 * Comprobantes (T-04).
 *
 * La promesa de CosteAR es que todo número se puede abrir "hasta el comprobante
 * donde exista un comprobante". Hasta esta corrección la tabla `evidence` no
 * tenía UN SOLO productor en todo el backend: `evidenceId` se aceptaba como
 * entrada opcional y se borraba al borrar una estructura, pero nadie creaba una
 * fila. La cadena terminaba siempre en el DataPoint —"lo cargó Fulano"— y
 * "está en esta factura", que es la respuesta que vale frente a un tercero, no
 * existía.
 *
 * Dos reglas del sistema mandan sobre este archivo:
 *
 *   R1 — append-only. Adjuntar un comprobante a un dato NO actualiza su versión
 *        vigente: crea una versión nueva que la lleva. (El trigger
 *        `data_point_versions_append_only` rechaza los UPDATE de todas formas;
 *        acá la regla se cumple por diseño, no porque la base la ataje.)
 *   R2 — toda mutación escribe su auditoría en la MISMA transacción.
 *
 * Y una decisión de producto: el alta NO depende del almacenamiento de
 * archivos. Un comprobante identificado (tipo + referencia + contraparte) sin
 * PDF ya es auditable; obligar a subir el archivo dejaría al costista sin
 * registrar nada el día que Cloudinary no esté configurado o se caiga.
 */

/** Qué pasó con el archivo. Se le dice al usuario, no queda en los logs. */
export type EstadoArchivo = 'guardado' | 'sin-archivo' | 'no-se-pudo-guardar';

export interface EvidenceView {
  id: string;
  kind: string;
  reference: string;
  counterparty: string | null;
  fileUrl: string | null;
  uploadedAt: string;
  archivo: EstadoArchivo;
  /** Mensaje en castellano cuando el archivo no quedó guardado. */
  aviso: string | null;
}

/** Carpeta de Cloudinary de los comprobantes (separada de entries y avatars). */
const CARPETA_COMPROBANTES = 'costear/comprobantes';

export class EvidenceService {
  constructor(
    private readonly db: PrismaClient = prisma,
    private readonly dataPoints: DataPointService = new DataPointService(db),
  ) {}

  /**
   * Da de alta un comprobante del costista.
   *
   * El upload va ANTES de abrir la transacción a propósito: una llamada de red
   * adentro de una transacción de base la mantiene abierta lo que tarde
   * Cloudinary. Si falla —o si no hay credenciales— el comprobante igual se
   * registra, con `fileUrl` en NULL y un aviso explícito: preferimos un
   * comprobante por referencia a no tener nada.
   */
  async create(userId: string, input: EvidenceInput, actor: TraceActor): Promise<EvidenceView> {
    const { fileUrl, archivo, aviso } = await this.resolverArchivo(input);

    return withTenant(userId, async (tx) => {
      const ev = await this.createInTx(
        tx,
        {
          kind: input.kind,
          reference: input.reference,
          counterparty: input.counterparty,
          fileUrl,
          uploadedBy: userId,
        },
        actor,
      );
      return this.toView(ev, archivo, aviso);
    });
  }

  /**
   * ── COSTURA PARA LA INGESTA DE DOCUMENTOS / CLASIFICADOR ──────────────────
   *
   * Punto de entrada único para crear un comprobante dentro de una transacción
   * YA abierta por el llamador. Existe para que
   * `src/application/ingest/ingest-data-entry.ts` —que hoy ya clasifica el
   * documento (`classification.documentType`), ya sube el archivo a Cloudinary
   * (`fileUrl`) y ya escribe DataEntry + ClassificationAudit + ProcessedCAE en
   * UNA sola transacción— pueda agregar el comprobante a ESA misma transacción:
   *
   *     const ev = await evidenceService.createInTx(tx, {
   *       kind: mapearTipoDocumento(classification.documentType), // 'factura' | ...
   *       reference: cae ?? numeroDeComprobante ?? input.fileName,
   *       counterparty: proveedorDetectado,
   *       fileUrl,                       // el que ya resolvió la ingesta
   *       uploadedBy: input.costistId,   // dueño = el costista de la conexión
   *     }, actor);
   *
   * y después, cuando el documento se convierta en un dato, pasar `ev.id` como
   * `evidenceId` de la versión 1 (`DataPointService.createInTx` ya lo acepta).
   * La integración NO se construye acá — esta es sólo la puerta.
   */
  async createInTx(
    tx: Prisma.TransactionClient,
    data: {
      kind: EvidenceKind | string;
      reference: string;
      counterparty?: string | null;
      fileUrl?: string | null;
      uploadedBy: string;
    },
    actor: TraceActor,
  ) {
    const ev = await tx.evidence.create({
      data: {
        kind: data.kind,
        reference: data.reference,
        counterparty: data.counterparty ?? null,
        fileUrl: data.fileUrl ?? null,
        uploadedBy: data.uploadedBy,
      },
    });
    await recordTraceAudit(
      {
        entityType: 'Evidence',
        entityId: ev.id,
        action: 'crear',
        actor,
        after: {
          kind: ev.kind,
          reference: ev.reference,
          counterparty: ev.counterparty,
          tieneArchivo: Boolean(ev.fileUrl),
        },
      },
      tx,
    );
    return ev;
  }

  /**
   * Adjunta un comprobante existente a un dato existente.
   *
   * NO pisa la versión vigente (R1): copia su valor tal cual —el número no
   * cambia, y ninguna cuenta puede moverse por adjuntar un papel— y guarda una
   * versión nueva que además lleva el comprobante.
   *
   * Tampoco toca el estado del dato: si estaba validado, sigue validado.
   * Volverlo a 'borrador' —como sí hace una corrección de valor— castigaría
   * justamente al que mejora el respaldo de un dato que ya alguien firmó.
   */
  async attach(
    userId: string,
    dataPointId: string,
    input: AttachEvidenceInput,
    actor: TraceActor,
  ) {
    const dp = await this.dataPoints.requireDataPoint(userId, dataPointId);
    if (dp.voidedAt || dp.status === 'anulado') {
      throw new ValidationError(
        'Este dato está anulado: no se le puede adjuntar un comprobante. Cargá el dato de nuevo con su comprobante.',
      );
    }

    return withTenant(userId, async (tx) => {
      // El dueño del comprobante se resuelve DENTRO de la transacción, con el
      // contexto de tenant puesto: así el filtro por `uploadedBy` y la política
      // RLS de `evidence` dicen exactamente lo mismo.
      const ev = await tx.evidence.findFirst({
        where: { id: input.evidenceId, uploadedBy: userId },
      });
      if (!ev) throw new NotFoundError('Comprobante no encontrado');

      const last = await tx.dataPointVersion.findFirst({
        where: { dataPointId },
        orderBy: { versionN: 'desc' },
      });
      if (!last) {
        throw new ValidationError('Este dato no tiene ninguna versión cargada todavía.');
      }

      // Idempotente: adjuntar dos veces el MISMO comprobante no genera una
      // versión nueva. Una versión que no cambia nada es ruido en el historial
      // que después hay que explicar.
      if (last.evidenceId === ev.id) {
        return {
          yaEstaba: true,
          versionN: last.versionN,
          evidence: this.toView(ev, ev.fileUrl ? 'guardado' : 'sin-archivo', null),
        };
      }

      const nextN = last.versionN + 1;
      const version = await tx.dataPointVersion.create({
        data: {
          dataPointId,
          versionN: nextN,
          // Mismo valor, letra por letra: adjuntar un comprobante no recalcula
          // nada.
          valueNum: last.valueNum,
          valueJson:
            last.valueJson === null ? undefined : (last.valueJson as Prisma.InputJsonValue),
          reason: input.reason,
          evidenceId: ev.id,
          // Se arrastra el método de captura de la versión anterior: describe
          // cómo entró EL VALOR al sistema, y eso no cambió por adjuntar el
          // papel. Pisarlo con 'manual' reescribiría el origen del número.
          method: last.method,
          createdBy: actor.id,
          actorRole: actor.role,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          actorArea: input.sourceArea as any,
          deviceInfo: actor.device,
        },
      });

      await recordTraceAudit(
        {
          entityType: 'DataPoint',
          entityId: dataPointId,
          action: 'adjuntar_comprobante',
          actor: { ...actor, area: input.sourceArea, method: last.method },
          before: { versionN: last.versionN, comprobante: null },
          after: {
            versionN: nextN,
            comprobante: { kind: ev.kind, reference: ev.reference, tieneArchivo: Boolean(ev.fileUrl) },
          },
          comment: input.reason,
        },
        tx,
      );

      return {
        yaEstaba: false,
        versionN: version.versionN,
        evidence: this.toView(ev, ev.fileUrl ? 'guardado' : 'sin-archivo', null),
      };
    });
  }

  /**
   * Resuelve el archivo del comprobante. Nunca lanza: el peor caso es un
   * comprobante por referencia con un aviso, no un alta perdida.
   */
  private async resolverArchivo(
    input: EvidenceInput,
  ): Promise<{ fileUrl: string | null; archivo: EstadoArchivo; aviso: string | null }> {
    if (input.fileUrl) return { fileUrl: input.fileUrl, archivo: 'guardado', aviso: null };
    if (!input.file) return { fileUrl: null, archivo: 'sin-archivo', aviso: null };

    try {
      const url = await uploadToCloudinary(
        input.file.data,
        input.file.mimeType,
        input.file.fileName,
        CARPETA_COMPROBANTES,
      );
      return { fileUrl: url, archivo: 'guardado', aviso: null };
    } catch (err) {
      // Se dice qué pasó y qué quedó guardado igual. Que el archivo no haya
      // subido no puede volverse invisible: el costista tiene que saber que
      // "Ver comprobante" no va a estar, y que el dato igual quedó respaldado
      // por la referencia.
      console.error('[evidence] No se pudo subir el archivo del comprobante:', err);
      return {
        fileUrl: null,
        archivo: 'no-se-pudo-guardar',
        aviso:
          'El comprobante quedó registrado por su referencia, pero el archivo no se pudo guardar. ' +
          'Guardalo por tu cuenta: la ficha va a mostrar el comprobante sin el archivo adjunto.',
      };
    }
  }

  private toView(
    ev: {
      id: string;
      kind: string;
      reference: string;
      counterparty: string | null;
      fileUrl: string | null;
      uploadedAt: Date;
    },
    archivo: EstadoArchivo,
    aviso: string | null,
  ): EvidenceView {
    return {
      id: ev.id,
      kind: ev.kind,
      reference: ev.reference,
      counterparty: ev.counterparty,
      fileUrl: ev.fileUrl,
      uploadedAt: ev.uploadedAt.toISOString(),
      archivo,
      aviso,
    };
  }
}
