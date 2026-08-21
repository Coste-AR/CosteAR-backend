import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundError } from '@/domain/errors/domain-error.js';

/**
 * Tests de CostStructureDeletionService (issue #99, B-02 🔴).
 *
 * Cubre:
 *   - softDelete: marca deletedAt, deja la auditoría, no borra nada
 *   - restore: limpia deletedAt, deja la auditoría
 *   - purge: auditoría ANTES de las eliminaciones, purge_mode activado,
 *            cascada completa de borrado
 *   - aislamiento: requireStructure filtra por userId — un usuario no puede
 *     operar sobre la estructura de otro
 *
 * El rollback transaccional real (si algo falla a mitad de la cascada, nada
 * queda borrado) necesita Postgres vivo y va en tests/integration/.
 */

const mockTx = {
  costStructure: { update: vi.fn(), delete: vi.fn() },
  dataPoint: { findMany: vi.fn(async () => []), deleteMany: vi.fn() },
  dataPointVersion: { findMany: vi.fn(async () => []), deleteMany: vi.fn() },
  evidence: { deleteMany: vi.fn() },
  calculationRun: { findMany: vi.fn(async () => []), deleteMany: vi.fn() },
  calculationNode: { deleteMany: vi.fn() },
  allocationBaseValue: { deleteMany: vi.fn() },
  costConfigVersion: { deleteMany: vi.fn() },
  costPeriod: { deleteMany: vi.fn() },
  auditLog: { create: vi.fn() },
  $executeRawUnsafe: vi.fn(),
};

const mockDb = {
  costStructure: { findFirst: vi.fn() },
  $transaction: vi.fn((cb: (tx: typeof mockTx) => unknown) => cb(mockTx)),
};

vi.mock('@/infrastructure/database/prisma.js', () => ({
  prisma: mockDb,
}));

const structure = {
  id: 'st-1',
  userId: 'u-1',
  productName: 'Fideos',
  companyId: 'co-1',
  period: '2026-01',
  deletedAt: null,
};

const ctx = { userId: 'u-1', ipAddress: '127.0.0.1', userAgent: 'test' };

describe('CostStructureDeletionService', () => {
  beforeEach(() => vi.clearAllMocks());

  // ── softDelete ──────────────────────────────────────────────────────────

  it('softDelete: actualiza deletedAt y registra auditoría', async () => {
    const { CostStructureDeletionService } = await import(
      '@/application/cost-structures/cost-structure-deletion-service.js'
    );
    const svc = new CostStructureDeletionService(mockDb as never);

    mockDb.costStructure.findFirst.mockResolvedValue(structure);
    const updated = { ...structure, deletedAt: new Date() };
    mockTx.costStructure.update.mockResolvedValue(updated);

    const result = await svc.softDelete('u-1', 'st-1', ctx);

    expect(mockTx.costStructure.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ deletedAt: expect.any(Date) }) }),
    );
    expect(mockTx.auditLog.create).toHaveBeenCalledOnce();
    // softDelete NO borra nada — ningún deleteMany debe haberse llamado
    expect(mockTx.dataPoint.findMany).not.toHaveBeenCalled();
    expect(mockTx.costStructure.delete).not.toHaveBeenCalled();
    expect(result).toMatchObject({ deletedAt: expect.any(Date) });
  });

  it('softDelete: falla si la estructura no existe', async () => {
    const { CostStructureDeletionService } = await import(
      '@/application/cost-structures/cost-structure-deletion-service.js'
    );
    const svc = new CostStructureDeletionService(mockDb as never);

    mockDb.costStructure.findFirst.mockResolvedValue(null);

    await expect(svc.softDelete('u-1', 'st-x', ctx)).rejects.toThrow(NotFoundError);
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });

  // ── restore ─────────────────────────────────────────────────────────────

  it('restore: limpia deletedAt y registra auditoría', async () => {
    const { CostStructureDeletionService } = await import(
      '@/application/cost-structures/cost-structure-deletion-service.js'
    );
    const svc = new CostStructureDeletionService(mockDb as never);

    mockDb.costStructure.findFirst.mockResolvedValue({ ...structure, deletedAt: new Date() });
    mockTx.costStructure.update.mockResolvedValue({ ...structure, deletedAt: null });

    await svc.restore('u-1', 'st-1', ctx);

    expect(mockTx.costStructure.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { deletedAt: null } }),
    );
    expect(mockTx.auditLog.create).toHaveBeenCalledOnce();
  });

  // ── purge ────────────────────────────────────────────────────────────────

  it('purge: activa purge_mode y ejecuta la cascada completa de borrado', async () => {
    const { CostStructureDeletionService } = await import(
      '@/application/cost-structures/cost-structure-deletion-service.js'
    );
    const svc = new CostStructureDeletionService(mockDb as never);

    mockDb.costStructure.findFirst.mockResolvedValue(structure);
    mockTx.dataPoint.findMany.mockResolvedValue([{ id: 'dp-1' }, { id: 'dp-2' }]);
    mockTx.dataPointVersion.findMany.mockResolvedValue([{ evidenceId: 'ev-1' }]);
    mockTx.calculationRun.findMany.mockResolvedValue([{ id: 'run-1' }]);

    await svc.purge('u-1', 'st-1', ctx);

    // purge_mode activado
    expect(mockTx.$executeRawUnsafe).toHaveBeenCalledWith(`SET LOCAL app.purge_mode = 'on'`);
    // cascada: versiones, puntos, evidencias, runs, nodos, bases, config, períodos, estructura
    expect(mockTx.dataPointVersion.deleteMany).toHaveBeenCalled();
    expect(mockTx.dataPoint.deleteMany).toHaveBeenCalled();
    expect(mockTx.evidence.deleteMany).toHaveBeenCalled();
    expect(mockTx.calculationNode.deleteMany).toHaveBeenCalled();
    expect(mockTx.calculationRun.deleteMany).toHaveBeenCalled();
    expect(mockTx.allocationBaseValue.deleteMany).toHaveBeenCalled();
    expect(mockTx.costConfigVersion.deleteMany).toHaveBeenCalled();
    expect(mockTx.costPeriod.deleteMany).toHaveBeenCalled();
    expect(mockTx.costStructure.delete).toHaveBeenCalledWith({ where: { id: 'st-1' } });
  });

  it('purge: la auditoría con oldValue se escribe ANTES de los borrados', async () => {
    const { CostStructureDeletionService } = await import(
      '@/application/cost-structures/cost-structure-deletion-service.js'
    );
    const svc = new CostStructureDeletionService(mockDb as never);

    mockDb.costStructure.findFirst.mockResolvedValue(structure);
    const callOrder: string[] = [];
    mockTx.auditLog.create.mockImplementation(() => {
      callOrder.push('audit');
    });
    mockTx.$executeRawUnsafe.mockImplementation(() => {
      callOrder.push('purge_mode');
    });
    mockTx.costStructure.delete.mockImplementation(() => {
      callOrder.push('delete');
    });

    await svc.purge('u-1', 'st-1', ctx);

    // El audit debe ser el primero: si la transacción rollbackea, queda el rastro
    expect(callOrder[0]).toBe('audit');
    expect(callOrder[1]).toBe('purge_mode');
    expect(callOrder[callOrder.length - 1]).toBe('delete');
  });

  it('purge: guarda productName en oldValue de la auditoría', async () => {
    const { CostStructureDeletionService } = await import(
      '@/application/cost-structures/cost-structure-deletion-service.js'
    );
    const svc = new CostStructureDeletionService(mockDb as never);

    mockDb.costStructure.findFirst.mockResolvedValue(structure);

    await svc.purge('u-1', 'st-1', ctx);

    const auditCall = mockTx.auditLog.create.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(auditCall.data.oldValue).toMatchObject({ productName: 'Fideos' });
  });

  // ── aislamiento por usuario ──────────────────────────────────────────────

  it('no puede borrar la estructura de otro usuario (requireStructure filtra userId)', async () => {
    const { CostStructureDeletionService } = await import(
      '@/application/cost-structures/cost-structure-deletion-service.js'
    );
    const svc = new CostStructureDeletionService(mockDb as never);

    // findFirst devuelve null porque userId='intruso' no coincide con la estructura
    mockDb.costStructure.findFirst.mockResolvedValue(null);

    await expect(svc.purge('intruso', 'st-1', ctx)).rejects.toThrow(NotFoundError);
    // Verificamos que la query incluyó el userId del intruso
    expect(mockDb.costStructure.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: 'intruso' }) }),
    );
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });
});
