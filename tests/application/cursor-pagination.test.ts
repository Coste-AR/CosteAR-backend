import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Paginación por cursor en `listDataPoints` y `listByCompany` (issue #101, B-07).
 *
 * Verificamos las tres invariantes del cursor-based pagination:
 *   1. Primera página sin cursor: devuelve hasta `limit` ítems + `nextCursor` apuntando
 *      al último cuando hay más.
 *   2. Primera página con resultados ≤ limit: `nextCursor` es null (no hay más).
 *   3. Página con cursor: se llama a Prisma con `cursor: { id }` y `skip: 1`, y el
 *      resultado incluye el nextCursor correcto (o null en la última página).
 */

// ─── DataPointService ──────────────────────────────────────────────────────

const mockDpDb = {
  dataPoint: { findMany: vi.fn() },
  costStructure: { findFirst: vi.fn() },
};

vi.mock('@/infrastructure/database/prisma.js', () => ({
  prisma: mockDpDb,
  withTenant: (_userId: string, fn: (tx: typeof mockDpDb) => unknown) => fn(mockDpDb),
}));

function makePoint(id: string) {
  return { id, element: 'MP', fieldKey: 'mp.precio', label: 'Harina', unit: 'kg', periodoImputado: 'P1' };
}

describe('DataPointService.listDataPoints — cursor pagination', () => {
  beforeEach(() => vi.clearAllMocks());

  it('primera página: nextCursor apunta al último ítem cuando hay más', async () => {
    const { DataPointService } = await import('@/application/trazabilidad/data-point-service.js');
    const svc = new DataPointService(mockDpDb as never);

    mockDpDb.costStructure.findFirst.mockResolvedValue({ id: 'st-1', userId: 'u-1' });
    // limit=2 → take=3; devolvemos 3 para indicar que hay más
    const three = [makePoint('a'), makePoint('b'), makePoint('c')];
    mockDpDb.dataPoint.findMany.mockResolvedValue(three);

    const result = await svc.listDataPoints('u-1', 'st-1', undefined, 2);

    expect(result.items).toHaveLength(2);
    expect(result.items.map((i) => i.id)).toEqual(['a', 'b']);
    expect(result.nextCursor).toBe('b');
  });

  it('última página: nextCursor es null cuando no hay más', async () => {
    const { DataPointService } = await import('@/application/trazabilidad/data-point-service.js');
    const svc = new DataPointService(mockDpDb as never);

    mockDpDb.costStructure.findFirst.mockResolvedValue({ id: 'st-1', userId: 'u-1' });
    // limit=5 → take=6; devolvemos solo 3, no hay más
    mockDpDb.dataPoint.findMany.mockResolvedValue([makePoint('x'), makePoint('y'), makePoint('z')]);

    const result = await svc.listDataPoints('u-1', 'st-1', undefined, 5);

    expect(result.items).toHaveLength(3);
    expect(result.nextCursor).toBeNull();
  });

  it('página con cursor: Prisma recibe cursor+skip y devuelve nextCursor correcto', async () => {
    const { DataPointService } = await import('@/application/trazabilidad/data-point-service.js');
    const svc = new DataPointService(mockDpDb as never);

    mockDpDb.costStructure.findFirst.mockResolvedValue({ id: 'st-1', userId: 'u-1' });
    // segunda página con limit=2: devolvemos solo 2 → última página
    mockDpDb.dataPoint.findMany.mockResolvedValue([makePoint('d'), makePoint('e')]);

    const result = await svc.listDataPoints('u-1', 'st-1', 'b', 2);

    const call = mockDpDb.dataPoint.findMany.mock.calls[0]![0] as Record<string, unknown>;
    expect(call).toMatchObject({ cursor: { id: 'b' }, skip: 1 });
    expect(result.items).toHaveLength(2);
    expect(result.nextCursor).toBeNull();
  });
});

// ─── CostStructureService ──────────────────────────────────────────────────

const mockCsDb = {
  costStructure: { findMany: vi.fn(), findFirst: vi.fn() },
  company: { findFirst: vi.fn() },
};

function makeStructure(id: string) {
  return { id, productName: `Producto ${id}`, companyId: 'co-1', userId: 'u-1', deletedAt: null, period: '2026-01' };
}

describe('CostStructureService.listByCompany — cursor pagination', () => {
  beforeEach(() => vi.clearAllMocks());

  it('primera página: nextCursor apunta al último ítem cuando hay más', async () => {
    const { CostStructureService } = await import('@/application/cost-structures/cost-structure-service.js');
    const svc = new CostStructureService(mockCsDb as never);

    mockCsDb.company.findFirst.mockResolvedValue({ id: 'co-1', userId: 'u-1' });
    const three = [makeStructure('s1'), makeStructure('s2'), makeStructure('s3')];
    mockCsDb.costStructure.findMany.mockResolvedValue(three);

    const result = await svc.listByCompany('u-1', 'co-1', false, undefined, 2);

    expect(result.items).toHaveLength(2);
    expect(result.nextCursor).toBe('s2');
  });

  it('última página: nextCursor es null', async () => {
    const { CostStructureService } = await import('@/application/cost-structures/cost-structure-service.js');
    const svc = new CostStructureService(mockCsDb as never);

    mockCsDb.company.findFirst.mockResolvedValue({ id: 'co-1', userId: 'u-1' });
    mockCsDb.costStructure.findMany.mockResolvedValue([makeStructure('s1')]);

    const result = await svc.listByCompany('u-1', 'co-1', false, undefined, 5);

    expect(result.items).toHaveLength(1);
    expect(result.nextCursor).toBeNull();
  });

  it('página con cursor: Prisma recibe cursor+skip', async () => {
    const { CostStructureService } = await import('@/application/cost-structures/cost-structure-service.js');
    const svc = new CostStructureService(mockCsDb as never);

    mockCsDb.company.findFirst.mockResolvedValue({ id: 'co-1', userId: 'u-1' });
    mockCsDb.costStructure.findMany.mockResolvedValue([makeStructure('s3')]);

    await svc.listByCompany('u-1', 'co-1', false, 's2', 2);

    const call = mockCsDb.costStructure.findMany.mock.calls[0]![0] as Record<string, unknown>;
    expect(call).toMatchObject({ cursor: { id: 's2' }, skip: 1 });
  });
});
