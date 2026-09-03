import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TelegramWebhookService,
  TELEGRAM_FIELD_KEYBOARD,
} from '@/application/empresa/telegram-webhook-service.js';

const { ingestDataEntry } = vi.hoisted(() => ({ ingestDataEntry: vi.fn() }));
vi.mock('@/application/ingest/ingest-data-entry.js', () => ({ ingestDataEntry }));

const MEMBERSHIP = {
  operatorId: 'operator-1',
  connectionId: 'connection-1',
  isActive: true,
  connection: { costistId: 'costist-1', companyId: 'company-1', isActive: true },
};

function makeDb(membership: unknown = MEMBERSHIP) {
  return { operatorMembership: { findUnique: vi.fn().mockResolvedValue(membership) } } as never;
}

function makeAlerts() {
  return { create: vi.fn().mockResolvedValue(undefined) } as never;
}

function makeFetch(bytes = 'archivo') {
  return vi
    .fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, result: { file_path: 'media/file.ogg' } }) })
    .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => Buffer.from(bytes) });
}

beforeEach(() => vi.clearAllMocks());

describe('TelegramWebhookService', () => {
  it('un texto asociado entra por ingest-data-entry con trazabilidad del operador', async () => {
    const svc = new TelegramWebhookService('token-prueba', makeDb(), makeAlerts());

    await svc.handleMessage({ chat: { id: 42 }, text: 'dato de ensayo' });

    expect(ingestDataEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: 'connection-1',
        companyId: 'company-1',
        uploadedBy: 'operator-1',
        sourceType: 'TELEGRAM',
        rawContent: 'dato de ensayo',
      }),
      expect.anything(),
    );
  });

  it('una foto descarga el archivo antes de ingresar la entrada pendiente', async () => {
    const fetcher = makeFetch('imagen-sintetica');
    const svc = new TelegramWebhookService('token-prueba', makeDb(), makeAlerts(), fetcher);

    await svc.handleMessage({ chat: { id: 42 }, photo: [{ file_id: 'photo-1', file_unique_id: 'p-1' }] });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(ingestDataEntry).toHaveBeenCalledWith(
      expect.objectContaining({ fileData: Buffer.from('imagen-sintetica').toString('base64'), fileMimeType: 'image/jpeg' }),
      expect.anything(),
    );
  });

  it('un audio descarga y conserva su tipo MIME', async () => {
    const fetcher = makeFetch('audio-sintetico');
    const svc = new TelegramWebhookService('token-prueba', makeDb(), makeAlerts(), fetcher);

    await svc.handleMessage({ chat: { id: 42 }, audio: { file_id: 'audio-1', mime_type: 'audio/mpeg', file_name: 'audio.mp3' } });

    expect(ingestDataEntry).toHaveBeenCalledWith(
      expect.objectContaining({ fileName: 'audio.mp3', fileMimeType: 'audio/mpeg' }),
      expect.anything(),
    );
  });

  it('un chat no asociado no crea una entrada y queda registrado como rechazo', async () => {
    const alerts = makeAlerts();
    const svc = new TelegramWebhookService('token-prueba', makeDb(null), alerts);

    await svc.handleMessage({ chat: { id: 987654 }, text: 'dato ajeno' });

    expect(ingestDataEntry).not.toHaveBeenCalled();
    expect((alerts as { create: ReturnType<typeof vi.fn> }).create).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'telegram-webhook', message: expect.stringMatching(/rechazado/i) }),
    );
  });

  it('el teclado de campo no muestra importes ni jerga contable', () => {
    expect(TELEGRAM_FIELD_KEYBOARD.keyboard.flat()).toEqual(['Huevos', 'Gallinas', 'Alimento', 'Peso']);
  });
});
