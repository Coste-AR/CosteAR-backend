import type { PrismaClient } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma.js';

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

    await this.db.dataEntry.create({
      data: {
        connectionId: conn.id,
        costistId: conn.costistId,
        rawContent: message.text.body,
        sourceType: 'WHATSAPP',
        status: 'PENDING',
      },
    });

    // TODO: Enviar mensaje de confirmación a WhatsApp y encolar job de IA
  }
}
