import type { PrismaClient } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma.js';
import { ingestDataEntry } from '../ingest/ingest-data-entry.js';
import { SystemAlertService } from '../system/system-alert-service.js';

/**
 * WEBHOOK DE WHATSAPP.
 *
 * Qué se arregló acá
 * ------------------
 * Este servicio **descartaba mensajes en silencio** en dos lugares: cuando el
 * mensaje no era texto, y cuando el número no estaba registrado. Sin log, sin
 * registro y sin respuesta.
 *
 * El resultado era el peor posible en un canal de campo: **el operario cree que
 * cargó un dato que nunca cargó.** No hay forma de que se entere. Se entera el
 * costista, semanas después, cuando cierra el mes y el número no cuadra.
 *
 * Y la foto no es un extra: la mitad de lo que se releva en campo no se escribe,
 * se fotografía.
 *
 * Regla que sale de esto:
 *
 * > Ningún mensaje se descarta sin dejar rastro. Si no se puede procesar, alguien
 * > se tiene que enterar.
 *
 * Lo que TODAVÍA no se puede hacer, y por qué
 * -------------------------------------------
 * Procesar la foto de verdad —bajarla de Meta y meterla al costo— necesita un
 * **token de acceso a la Graph API** que hoy no existe: la única credencial
 * configurada es `WHATSAPP_APP_SECRET`, que sirve para verificar la firma del
 * webhook, no para descargar archivos ni para responder.
 *
 * Por eso, mientras tanto, un mensaje no soportado **genera una alerta al equipo
 * con los datos para poder actuar**, en vez de desaparecer. Es la diferencia
 * entre un dato perdido y un dato pendiente.
 *
 * Lo que falta para cerrar el caso está en el issue del repo.
 */

/** Tipos que Meta puede mandar. Se nombran para poder decir cuál llegó. */
type TipoMensaje = 'texto' | 'imagen' | 'audio' | 'documento' | 'video' | 'ubicacion' | 'otro';

const TIPOS_SOPORTADOS: TipoMensaje[] = ['texto'];

function detectarTipo(message: any): TipoMensaje {
  if (message?.text?.body) return 'texto';
  if (message?.image) return 'imagen';
  if (message?.audio || message?.voice) return 'audio';
  if (message?.document) return 'documento';
  if (message?.video) return 'video';
  if (message?.location) return 'ubicacion';
  return 'otro';
}

/**
 * Deja visibles los últimos 4 dígitos y tapa el resto.
 *
 * El número de teléfono de un operario es un dato personal: alcanza con poder
 * identificar de cuál se trata para devolverle la llamada, no hace falta que
 * quede entero en cada alerta del sistema.
 */
export function ofuscarNumero(numero: string): string {
  const limpio = String(numero ?? '').trim();
  if (limpio.length <= 4) return '****';
  return `****${limpio.slice(-4)}`;
}

export class WhatsappWebhookService {
  constructor(
    private readonly db: PrismaClient = prisma,
    private readonly alerts: SystemAlertService = new SystemAlertService(),
  ) {}

  /**
   * Procesa un mensaje entrante desde el webhook de Meta.
   *
   * Nunca devuelve sin dejar rastro: cada camino que no termina en una ingesta
   * deja una alerta con el motivo.
   */
  async handleMessage(from: string, message: any): Promise<void> {
    const tipo = detectarTipo(message);
    const numero = ofuscarNumero(from);

    const conn = await this.db.empresaConnection.findUnique({
      where: { whatsappPhoneNumber: from, isActive: true },
    });

    // ── El número no está registrado ────────────────────────────────────────
    //
    // Antes se ignoraba en silencio. Pero un mensaje de un número desconocido no
    // es ruido: casi siempre es un operario nuevo al que nadie dio de alta, o
    // alguien escribiendo desde otro teléfono. En los dos casos hay una persona
    // esperando que su dato entre, y hay que poder avisarle.
    if (!conn) {
      await this.alerts.create({
        source: 'whatsapp-webhook',
        level: 'warning',
        message:
          `Llegó un mensaje de tipo "${tipo}" desde un número NO registrado (${numero}). ` +
          'No se procesó. Si es un operario que corresponde dar de alta, cargalo en la ' +
          'conexión de la empresa; si no, se puede ignorar. ' +
          'La persona que escribió no recibió ninguna respuesta.',
      });
      return;
    }

    // ── Tipo no soportado todavía ───────────────────────────────────────────
    if (!TIPOS_SOPORTADOS.includes(tipo)) {
      await this.alerts.create({
        source: 'whatsapp-webhook',
        level: 'warning',
        message:
          `Llegó un mensaje de tipo "${tipo}" desde ${numero} (empresa ${conn.companyId}) y ` +
          'NO se pudo procesar: falta el token de acceso a la Graph API para descargar el ' +
          'archivo. El dato NO se perdió, pero tampoco entró: hay que pedírselo por otra vía. ' +
          'La persona que lo mandó no recibió ninguna respuesta y puede creer que quedó cargado.',
      });
      return;
    }

    // ── Texto: el camino que sí funciona ────────────────────────────────────
    //
    // Se clasifica por el mismo camino que el portal. `rejectIllegible` en false:
    // acá no hay nadie leyendo el error, así que un texto que no pasa el quality
    // gate se guarda marcado para revisión en vez de perderse.
    await ingestDataEntry(
      {
        connectionId: conn.id,
        costistId: conn.costistId,
        companyId: conn.companyId,
        rawContent: message.text.body,
        sourceType: 'WHATSAPP',
        rejectIllegible: false,
      },
      { db: this.db },
    );

    // NOTA: acá iría la confirmación al remitente, y hoy no se puede.
    //
    // Responder necesita el token de acceso de la Graph API y el id del número,
    // que no están configurados. Mientras tanto **nadie que escriba por WhatsApp
    // recibe confirmación de nada**, ni cuando el dato entra bien. Está en el
    // issue del repo como parte del mismo trabajo.
  }
}
