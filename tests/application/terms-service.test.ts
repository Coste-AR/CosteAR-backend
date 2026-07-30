import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TermsService } from '@/application/legal/terms-service.js';

/**
 * Términos y Condiciones: versionado explícito, nunca se edita el contenido
 * ya publicado — "editar" desde admin publica una versión nueva. Estos tests
 * fijan las reglas centrales: quién necesita (re)aceptar, que no se puede
 * aceptar una versión vieja, y que publicar nunca deja dos versiones activas.
 */

const db = {
  termsVersion: { findFirst: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
  termsAcceptance: { findUnique: vi.fn(), upsert: vi.fn() },
  $transaction: vi.fn(),
};

function service() {
  return new TermsService(db as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  db.$transaction.mockImplementation(async (fn: (tx: typeof db) => unknown) => fn(db));
});

describe('TermsService.needsAcceptance', () => {
  it('false para roles que no son COSTISTA (ADMIN, EMPRESA_OPERATOR) — nunca consulta la base', async () => {
    const result = await service().needsAcceptance('user-1', 'ADMIN');
    expect(result).toEqual({ needs: false, current: null });
    expect(db.termsVersion.findFirst).not.toHaveBeenCalled();
  });

  it('true si el costista nunca aceptó ninguna versión', async () => {
    db.termsVersion.findFirst.mockResolvedValue({ id: 'v1', version: 1 });
    db.termsAcceptance.findUnique.mockResolvedValue(null);

    const result = await service().needsAcceptance('user-1', 'COSTISTA');

    expect(result.needs).toBe(true);
    expect(result.current).toEqual({ id: 'v1', version: 1 });
  });

  it('false si ya aceptó exactamente la versión activa', async () => {
    db.termsVersion.findFirst.mockResolvedValue({ id: 'v1', version: 1 });
    db.termsAcceptance.findUnique.mockResolvedValue({ id: 'acc-1' });

    const result = await service().needsAcceptance('user-1', 'COSTISTA');

    expect(result.needs).toBe(false);
  });

  it('true si aceptó una versión VIEJA y se publicó una nueva (el caso central de la feature)', async () => {
    db.termsVersion.findFirst.mockResolvedValue({ id: 'v2', version: 2 });
    // Su aceptación es de v1 — el lookup busca específicamente v2, no la encuentra.
    db.termsAcceptance.findUnique.mockResolvedValue(null);

    const result = await service().needsAcceptance('user-1', 'COSTISTA');

    expect(result.needs).toBe(true);
    expect(db.termsAcceptance.findUnique).toHaveBeenCalledWith({
      where: { userId_termsVersionId: { userId: 'user-1', termsVersionId: 'v2' } },
    });
  });
});

describe('TermsService.accept', () => {
  it('rechaza aceptar una versión que ya no es la activa', async () => {
    db.termsVersion.findFirst.mockResolvedValue({ id: 'v2', version: 2 });

    await expect(service().accept('user-1', 'v1-vieja', {})).rejects.toThrow(/ya no está vigente/);
    expect(db.termsAcceptance.upsert).not.toHaveBeenCalled();
  });

  it('registra la aceptación con IP y user-agent cuando la versión coincide', async () => {
    db.termsVersion.findFirst.mockResolvedValue({ id: 'v2', version: 2 });
    db.termsAcceptance.upsert.mockResolvedValue({});

    await service().accept('user-1', 'v2', { ipAddress: '1.2.3.4', userAgent: 'test-agent' });

    expect(db.termsAcceptance.upsert).toHaveBeenCalledWith({
      where: { userId_termsVersionId: { userId: 'user-1', termsVersionId: 'v2' } },
      create: { userId: 'user-1', termsVersionId: 'v2', ipAddress: '1.2.3.4', userAgent: 'test-agent' },
      update: {},
    });
  });

  it('es idempotente: doble click no falla (upsert, no create)', async () => {
    db.termsVersion.findFirst.mockResolvedValue({ id: 'v2', version: 2 });
    db.termsAcceptance.upsert.mockResolvedValue({});

    await expect(service().accept('user-1', 'v2', {})).resolves.toBeUndefined();
  });
});

describe('TermsService.requireCurrentVersion', () => {
  it('tira un error accionable si no hay ninguna versión activa (ambiente mal sembrado)', async () => {
    db.termsVersion.findFirst.mockResolvedValue(null);
    await expect(service().requireCurrentVersion()).rejects.toThrow(/No hay una versión vigente/);
  });
});

describe('TermsService.publish', () => {
  it('incrementa la versión, desactiva la anterior y activa la nueva en una sola transacción', async () => {
    db.termsVersion.findFirst.mockResolvedValue({ id: 'v1', version: 1 });
    db.termsVersion.create.mockResolvedValue({ id: 'v2', version: 2, content: 'nuevo texto', isActive: true });

    const result = await service().publish('nuevo texto', 'admin-1');

    expect(db.termsVersion.updateMany).toHaveBeenCalledWith({ where: { isActive: true }, data: { isActive: false } });
    expect(db.termsVersion.create).toHaveBeenCalledWith({
      data: { version: 2, content: 'nuevo texto', isActive: true, createdBy: 'admin-1' },
    });
    expect(result.version).toBe(2);
  });

  it('primera publicación (sin versiones previas) arranca en la versión 1', async () => {
    db.termsVersion.findFirst.mockResolvedValue(null);
    db.termsVersion.create.mockResolvedValue({ id: 'v1', version: 1 });

    await service().publish('texto inicial', 'admin-1');

    expect(db.termsVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ version: 1 }) }),
    );
  });
});
