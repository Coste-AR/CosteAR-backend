import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WhatsappWebhookService } from '../../src/application/empresa/whatsapp-webhook-service.js';

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    empresaConnection: { findUnique: vi.fn() },
    dataEntry: { create: vi.fn() },
  },
}));

vi.mock('../../src/infrastructure/database/prisma.js', () => ({ prisma: mockDb }));

beforeEach(() => vi.clearAllMocks());

describe('WhatsappWebhookService.handleMessage', () => {
  it('ignora mensajes que no tienen texto', async () => {
    const svc = new WhatsappWebhookService(mockDb as never);
    await svc.handleMessage('5493815551234', { image: {} });
    expect(mockDb.empresaConnection.findUnique).not.toHaveBeenCalled();
    expect(mockDb.dataEntry.create).not.toHaveBeenCalled();
  });

  it('procesa el mensaje de texto si el número está registrado', async () => {
    mockDb.empresaConnection.findUnique.mockResolvedValue({
      id: 'conn-1',
      costistId: 'user-1',
      isActive: true,
    });
    mockDb.dataEntry.create.mockResolvedValue({ id: 'entry-1' });

    const svc = new WhatsappWebhookService(mockDb as never);
    await svc.handleMessage('5493815551234', { text: { body: 'Compré 10 kg de harina a $5000' } });

    expect(mockDb.empresaConnection.findUnique).toHaveBeenCalledWith({
      where: { whatsappPhoneNumber: '5493815551234', isActive: true },
    });
    expect(mockDb.dataEntry.create).toHaveBeenCalledWith({
      data: {
        connectionId: 'conn-1',
        costistId: 'user-1',
        rawContent: 'Compré 10 kg de harina a $5000',
        sourceType: 'WHATSAPP',
        status: 'PENDING',
      },
    });
  });

  it('ignora si el número no está registrado', async () => {
    mockDb.empresaConnection.findUnique.mockResolvedValue(null);

    const svc = new WhatsappWebhookService(mockDb as never);
    await svc.handleMessage('5493815559999', { text: { body: 'Hola' } });

    expect(mockDb.empresaConnection.findUnique).toHaveBeenCalled();
    expect(mockDb.dataEntry.create).not.toHaveBeenCalled();
  });
});
