import { describe, expect, it, vi } from 'vitest';
import { OperatorScopeService } from '../../src/application/empresa/operator-scope-service.js';

function db(overrides: Record<string, unknown> = {}) {
  return {
    operatorUnidadProductiva: { findFirst: vi.fn().mockResolvedValue(null) },
    operatorDeposito: { findFirst: vi.fn().mockResolvedValue(null) },
    operatorOrdenTrabajo: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
    operatorMembership: { findFirst: vi.fn().mockResolvedValue(null) },
    loteProductivo: { findUnique: vi.fn() },
    traceAuditLog: { create: vi.fn().mockResolvedValue({}) },
    ...overrides,
  } as never;
}

const actor = { id: '11111111-1111-4111-8111-111111111111', role: 'EMPRESA_OPERATOR', area: 'costista', method: 'manual' };

describe('alcance por entidad del cargador', () => {
  it('niega por defecto una membresía sin entidades autorizadas y audita el intento', async () => {
    const mock = db();
    await expect(new OperatorScopeService(mock).assertDeposito(actor.id, '22222222-2222-4222-8222-222222222222', actor))
      .rejects.toMatchObject({ statusCode: 403 });
    expect(mock.traceAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'scope.denied' }),
    }));
  });

  it('autoriza solamente el depósito asignado', async () => {
    const findFirst = vi.fn().mockResolvedValue({ membershipId: 'membership' });
    const mock = db({ operatorDeposito: { findFirst } });
    await expect(new OperatorScopeService(mock).assertDeposito(actor.id, '22222222-2222-4222-8222-222222222222', actor)).resolves.toBeUndefined();
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ membership: { operatorId: actor.id, isActive: true } }),
    }));
  });

  it('niega por defecto el informe de margen sin permiso explícito', async () => {
    await expect(new OperatorScopeService(db()).assertPermission(actor.id, 'ordenes.ver_margen'))
      .rejects.toMatchObject({ statusCode: 403 });
  });

  it('exige entidad y función para acceder a una orden', async () => {
    const findFirst = vi.fn().mockResolvedValue({ membershipId: 'membership' });
    const mock = db({ operatorOrdenTrabajo: { findFirst, findMany: vi.fn() } });
    await expect(new OperatorScopeService(mock).assertOrden(actor.id, '33333333-3333-4333-8333-333333333333', 'ordenes.ver'))
      .resolves.toBeUndefined();
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      membership: { operatorId: actor.id, isActive: true, permisos: { has: 'ordenes.ver' } },
    }) }));
  });
});
