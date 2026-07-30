import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WhatsappWebhookService } from '../../src/application/empresa/whatsapp-webhook-service.js';

const { mockDb, mockIngest } = vi.hoisted(() => ({
  mockDb: {
    empresaConnection: { findUnique: vi.fn() },
    dataEntry: { create: vi.fn() },
  },
  mockIngest: vi.fn(),
}));

vi.mock('../../src/infrastructure/database/prisma.js', () => ({ prisma: mockDb }));
vi.mock('../../src/application/ingest/ingest-data-entry.js', () => ({
  ingestDataEntry: mockIngest,
}));

beforeEach(() => vi.clearAllMocks());

describe('WhatsappWebhookService.handleMessage', () => {
  it('ignora mensajes que no tienen texto', async () => {
    const svc = new WhatsappWebhookService(mockDb as never);
    await svc.handleMessage('5493815551234', { image: {} });
    expect(mockDb.empresaConnection.findUnique).not.toHaveBeenCalled();
    expect(mockIngest).not.toHaveBeenCalled();
  });

  it('procesa el mensaje de texto si el número está registrado', async () => {
    mockDb.empresaConnection.findUnique.mockResolvedValue({
      id: 'conn-1',
      costistId: 'user-1',
      companyId: 'company-1',
      isActive: true,
    });
    mockIngest.mockResolvedValue({ isDuplicate: false, id: 'entry-1', status: 'PENDING' });

    const svc = new WhatsappWebhookService(mockDb as never);
    await svc.handleMessage('5493815551234', { text: { body: 'Compré 10 kg de harina a $5000' } });

    expect(mockDb.empresaConnection.findUnique).toHaveBeenCalledWith({
      where: { whatsappPhoneNumber: '5493815551234', isActive: true },
    });
    // Lo que llega por WhatsApp se clasifica igual que lo que sube el portal:
    // nunca se crea una DataEntry sin pasar por el camino de ingesta.
    expect(mockIngest).toHaveBeenCalledWith(
      {
        connectionId: 'conn-1',
        costistId: 'user-1',
        companyId: 'company-1',
        rawContent: 'Compré 10 kg de harina a $5000',
        sourceType: 'WHATSAPP',
        rejectIllegible: false,
      },
      { db: mockDb },
    );
    expect(mockDb.dataEntry.create).not.toHaveBeenCalled();
  });

  it('ignora si el número no está registrado', async () => {
    mockDb.empresaConnection.findUnique.mockResolvedValue(null);

    const svc = new WhatsappWebhookService(mockDb as never);
    await svc.handleMessage('5493815559999', { text: { body: 'Hola' } });

    expect(mockDb.empresaConnection.findUnique).toHaveBeenCalled();
    expect(mockIngest).not.toHaveBeenCalled();
  });
});
