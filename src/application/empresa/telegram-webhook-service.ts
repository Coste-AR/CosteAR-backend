import type { PrismaClient } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma.js';
import { ingestDataEntry } from '../ingest/ingest-data-entry.js';
import { SystemAlertService } from '../system/system-alert-service.js';

export const TELEGRAM_FIELD_KEYBOARD = {
  keyboard: [['Huevos', 'Gallinas'], ['Alimento', 'Peso']],
  resize_keyboard: true,
  one_time_keyboard: false,
};

export interface TelegramFile {
  file_id: string;
  file_unique_id?: string;
  mime_type?: string;
  file_name?: string;
}

export interface TelegramMessage {
  chat: { id: number | string };
  text?: string;
  caption?: string;
  photo?: TelegramFile[];
  audio?: TelegramFile;
  voice?: TelegramFile;
}

type FetchLike = typeof fetch;

export class TelegramWebhookService {
  constructor(
    private readonly token: string,
    private readonly db: PrismaClient = prisma,
    private readonly alerts: SystemAlertService = new SystemAlertService(),
    private readonly fetcher: FetchLike = fetch,
  ) {}

  async handleMessage(message: TelegramMessage): Promise<void> {
    const chatId = String(message.chat.id);
    const membership = await this.db.operatorMembership.findUnique({
      where: { telegramChatId: chatId },
      include: { connection: true },
    });

    if (!membership || !membership.isActive || !membership.connection.isActive) {
      await this.alerts.create({
        source: 'telegram-webhook',
        level: 'warning',
        message: `Mensaje de Telegram rechazado: chat no asociado o membresía inactiva (${ofuscarChat(chatId)}).`,
      });
      return;
    }

    const media = message.photo?.at(-1) ?? message.audio ?? message.voice;
    const attachment = media ? await this.download(media) : null;

    await ingestDataEntry(
      {
        connectionId: membership.connectionId,
        costistId: membership.connection.costistId,
        companyId: membership.connection.companyId,
        uploadedBy: membership.operatorId,
        rawContent: message.text ?? message.caption ?? '',
        sourceType: 'TELEGRAM',
        fileName: attachment?.fileName ?? null,
        fileData: attachment?.fileData ?? null,
        fileMimeType: attachment?.mimeType ?? null,
        rejectIllegible: false,
      },
      { db: this.db },
    );
  }

  private async download(file: TelegramFile) {
    const lookup = await this.fetcher(`https://api.telegram.org/bot${this.token}/getFile?file_id=${encodeURIComponent(file.file_id)}`);
    if (!lookup.ok) throw new Error(`Telegram getFile respondió ${lookup.status}`);
    const json = (await lookup.json()) as { ok?: boolean; result?: { file_path?: string } };
    const path = json.result?.file_path;
    if (!json.ok || !path) throw new Error('Telegram no devolvió la ruta del archivo');

    const response = await this.fetcher(`https://api.telegram.org/file/bot${this.token}/${path}`);
    if (!response.ok) throw new Error(`Telegram file respondió ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const extension = path.split('.').at(-1) ?? 'bin';
    return {
      fileName: file.file_name ?? `telegram-${file.file_unique_id ?? file.file_id}.${extension}`,
      fileData: bytes.toString('base64'),
      mimeType: file.mime_type ?? (messageIsImage(file) ? 'image/jpeg' : 'audio/ogg'),
    };
  }
}

function messageIsImage(file: TelegramFile): boolean {
  return !file.mime_type && !file.file_name;
}

function ofuscarChat(chatId: string): string {
  return chatId.length <= 4 ? '****' : `****${chatId.slice(-4)}`;
}
