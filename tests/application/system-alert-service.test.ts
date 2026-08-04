import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SystemAlertService } from '@/application/system/system-alert-service.js';

/**
 * `SystemAlertService` no tenía NINGÚN test que ejercitara sus consultas: solo
 * `verifySentrySignature`/`sanitizeUrl` (funciones puras) estaban cubiertas.
 * Por eso nadie se enteró de que `list()` pedía columnas
 * (`culprit`, `errorType`, ...) que nunca tuvieron migración -- ver la
 * migración `20260804010000_add_system_alert_issue_details`. Un mock de
 * Prisma no reproduce ese bug (no valida contra un esquema real), pero
 * fija el comportamiento del servicio para que no se rompa de otra forma.
 */

const mockDb = {
  systemAlert: { findMany: vi.fn(), create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
};

beforeEach(() => vi.clearAllMocks());

describe('SystemAlertService', () => {
  it('list() sin filtro trae todas, ordenadas por más reciente, tope 200', async () => {
    mockDb.systemAlert.findMany.mockResolvedValue([]);
    const service = new SystemAlertService(mockDb as never);

    await service.list(false);

    expect(mockDb.systemAlert.findMany).toHaveBeenCalledWith({
      where: undefined,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  });

  it('list(true) filtra solo las no resueltas', async () => {
    mockDb.systemAlert.findMany.mockResolvedValue([]);
    const service = new SystemAlertService(mockDb as never);

    await service.list(true);

    expect(mockDb.systemAlert.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { resolvedAt: null } }),
    );
  });

  it('create() persiste el detalle del issue de Sentry (culprit, tipo, ocurrencias)', async () => {
    mockDb.systemAlert.create.mockResolvedValue({ id: 'a1' });
    const service = new SystemAlertService(mockDb as never);

    const data = {
      source: 'sentry',
      level: 'error',
      message: 'TypeError: x is not a function',
      culprit: 'src/foo.ts in bar',
      errorType: 'TypeError',
      errorValue: 'x is not a function',
      occurrenceCount: 12,
      platform: 'node',
    };
    await service.create(data);

    expect(mockDb.systemAlert.create).toHaveBeenCalledWith({ data });
  });

  it('resolve() marca resolvedAt en una alerta existente', async () => {
    mockDb.systemAlert.findUnique.mockResolvedValue({ id: 'a1', resolvedAt: null });
    mockDb.systemAlert.update.mockResolvedValue({ id: 'a1', resolvedAt: new Date() });
    const service = new SystemAlertService(mockDb as never);

    await service.resolve('a1');

    expect(mockDb.systemAlert.update).toHaveBeenCalledWith({
      where: { id: 'a1' },
      data: { resolvedAt: expect.any(Date) },
    });
  });

  it('resolve() sobre una alerta inexistente corta con NotFoundError, no la crea', async () => {
    mockDb.systemAlert.findUnique.mockResolvedValue(null);
    const service = new SystemAlertService(mockDb as never);

    await expect(service.resolve('no-existe')).rejects.toThrow('System alert not found');
    expect(mockDb.systemAlert.update).not.toHaveBeenCalled();
  });
});
