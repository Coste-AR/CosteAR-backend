import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AllocationBaseService } from '@/application/cost-structures/allocation-base-service.js';

/**
 * 3b-2 — al guardar, las UNIDADES por centro de una base se persisten en el
 * registro trazable (append-only). `syncValues` es el espejo config → tabla:
 *  - versiona SOLO los centros cuyo valor cambió (no infla el historial),
 *  - anula (baja lógica) los centros que ya no están en la base,
 *  - no persiste nada si la base no está en el catálogo (valor legado).
 *
 * Prisma va mockeado (mismo patrón que data-point-service.test.ts): no depende
 * de una base viva. `$transaction` ejecuta el callback con el mismo mock.
 */
const db = {
  costStructure: { findFirst: vi.fn() },
  allocationBase: { findFirst: vi.fn() },
  allocationBaseValue: { findMany: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
  $transaction: vi.fn(async (fn: (tx: typeof db) => unknown) => fn(db)),
};

function service() {
  return new AllocationBaseService(db as never);
}

describe('AllocationBaseService.syncValues — espejo trazable de las bases (3b-2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Estructura válida del usuario (requireStructure).
    db.costStructure.findFirst.mockResolvedValue({ id: 'st-1', userId: 'user-1', companyId: 'co-1', company: {} });
    db.allocationBaseValue.create.mockResolvedValue({ id: 'v-new' });
    db.allocationBaseValue.updateMany.mockResolvedValue({ count: 1 });
  });

  it('versiona SOLO lo que cambió y anula el centro que ya no está', async () => {
    db.allocationBase.findFirst.mockResolvedValue({ id: 'base-1', companyId: null, code: 'superficie_m2' });
    db.allocationBaseValue.findMany.mockResolvedValue([
      { centerId: 'corte', value: 60 },
      { centerId: 'armado', value: 40 },
      { centerId: 'viejo', value: 10 },
    ]);

    // corte igual (60), armado cambia (40→30), viejo ya no está.
    const changed = await service().syncValues('user-1', 'st-1', 'superficie_m2', { corte: 60, armado: 30 });

    expect(changed).toBe(2);
    // Solo se crea una versión nueva: la de armado (corte no cambió).
    expect(db.allocationBaseValue.create).toHaveBeenCalledTimes(1);
    expect(db.allocationBaseValue.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ baseId: 'base-1', structureId: 'st-1', centerId: 'armado', value: 30, createdBy: 'user-1' }),
      }),
    );
    // Se anulan: la versión vieja de armado (dentro de setValue) y la de 'viejo'.
    expect(db.allocationBaseValue.updateMany).toHaveBeenCalledTimes(2);
    expect(db.allocationBaseValue.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ centerId: 'viejo', voidedAt: null }) }),
    );
  });

  it('si nada cambió, NO versiona (idempotente)', async () => {
    db.allocationBase.findFirst.mockResolvedValue({ id: 'base-1', companyId: null, code: 'superficie_m2' });
    db.allocationBaseValue.findMany.mockResolvedValue([
      { centerId: 'corte', value: 60 },
      { centerId: 'armado', value: 40 },
    ]);

    const changed = await service().syncValues('user-1', 'st-1', 'superficie_m2', { corte: 60, armado: 40 });

    expect(changed).toBe(0);
    expect(db.allocationBaseValue.create).not.toHaveBeenCalled();
    expect(db.allocationBaseValue.updateMany).not.toHaveBeenCalled();
  });

  it('base fuera del catálogo → no persiste nada (devuelve 0)', async () => {
    db.allocationBase.findFirst.mockResolvedValue(null);

    const changed = await service().syncValues('user-1', 'st-1', 'base_inexistente', { corte: 5 });

    expect(changed).toBe(0);
    expect(db.allocationBaseValue.findMany).not.toHaveBeenCalled();
    expect(db.allocationBaseValue.create).not.toHaveBeenCalled();
  });
});
