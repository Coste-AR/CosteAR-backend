import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDb = {
  empresaConnection: { findFirst: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
};
vi.mock('@/infrastructure/database/prisma.js', () => ({ prisma: mockDb }));

beforeEach(() => vi.clearAllMocks());

describe('EmpresaConnectionService.setWhatsappNumber', () => {
  it('actualiza el número de WhatsApp de una conexión propia del costista', async () => {
    const { EmpresaConnectionService } = await import('@/application/empresa/empresa-connection-service.js');
    mockDb.empresaConnection.findFirst.mockResolvedValue({ id: 'conn-1', costistId: 'user-1' });
    mockDb.empresaConnection.update.mockResolvedValue({ id: 'conn-1', whatsappPhoneNumber: '5493815551234' });

    const svc = new EmpresaConnectionService(mockDb as never);
    const res = await svc.setWhatsappNumber('user-1', 'conn-1', '5493815551234');

    expect(mockDb.empresaConnection.findFirst).toHaveBeenCalledWith({
      where: { id: 'conn-1', costistId: 'user-1' },
    });
    expect(mockDb.empresaConnection.update).toHaveBeenCalledWith({
      where: { id: 'conn-1' },
      data: { whatsappPhoneNumber: '5493815551234' },
    });
    expect(res.whatsappPhoneNumber).toBe('5493815551234');
  });

  it('rechaza si la conexión no es del costista (defensa en profundidad, mismo patrón que el resto del servicio)', async () => {
    const { EmpresaConnectionService } = await import('@/application/empresa/empresa-connection-service.js');
    mockDb.empresaConnection.findFirst.mockResolvedValue(null);

    const svc = new EmpresaConnectionService(mockDb as never);
    await expect(svc.setWhatsappNumber('user-1', 'conn-ajena', '5493815551234')).rejects.toThrow();
    expect(mockDb.empresaConnection.update).not.toHaveBeenCalled();
  });
});
