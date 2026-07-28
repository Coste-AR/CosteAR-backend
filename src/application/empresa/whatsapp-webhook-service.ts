import type { PrismaClient } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma.js';
import { ingestDataEntry } from '../ingest/ingest-data-entry.js';

export class WhatsappWebhookService {
  constructor(private readonly db: PrismaClient = prisma) {}

  /**
   * Procesa un mensaje entrante desde el webhook de Meta.
   */
  async handleMessage(from: string, message: any) {
    if (!message.text || !message.text.body) {
      // Ignoramos audios, imágenes u otros tipos de mensajes por ahora
      return;
    }

    const conn = await this.db.empresaConnection.findUnique({
      where: { whatsappPhoneNumber: from, isActive: true },
    });

    if (!conn) {
      // Si el número no está registrado, ignoramos silenciosamente
      return;
    }

    // La entrada se clasifica en el mismo camino que el portal. `rejectIllegible`
    // en false: acá no hay nadie leyendo el error, así que un texto que no pasa
    // el quality gate se guarda igual marcado para revisión en vez de perderse.
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

    // TODO: Enviar mensaje de confirmación a WhatsApp
  }
}
