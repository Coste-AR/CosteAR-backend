import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDb = { macroSnapshot: { findMany: vi.fn() } };
vi.mock('@/infrastructure/database/prisma.js', () => ({ prisma: mockDb }));

beforeEach(() => vi.clearAllMocks());

describe('MacroService.cumulativeInflation', () => {
  it('compone tasas mensuales (no las suma): dos meses de 5% dan 10.25%, no 10%', async () => {
    const { MacroService } = await import('@/application/macro/macro-service.js');
    mockDb.macroSnapshot.findMany.mockResolvedValue([
      { indicatorCode: 'IPC_NACIONAL', value: '5', effectiveDate: new Date('2026-05-31') },
      { indicatorCode: 'IPC_NACIONAL', value: '5', effectiveDate: new Date('2026-06-30') },
    ]);

    const svc = new MacroService(mockDb as never);
    const res = await svc.cumulativeInflation(new Date('2026-05-01'), new Date('2026-06-30'));

    expect(res).not.toBeNull();
    expect(res!.deltaPct).toBe(10.25); // (1.05 * 1.05 - 1) * 100
    expect(res!.monthsUsed).toBe(2);
    expect(res!.snapshots).toHaveLength(2);
  });

  it('sin ningún snapshot de IPC en el rango, devuelve null (nunca inventa)', async () => {
    const { MacroService } = await import('@/application/macro/macro-service.js');
    mockDb.macroSnapshot.findMany.mockResolvedValue([]);

    const svc = new MacroService(mockDb as never);
    const res = await svc.cumulativeInflation(new Date('2026-05-01'), new Date('2026-06-30'));

    expect(res).toBeNull();
  });

  it('un solo mes en el rango compone igual (factor único)', async () => {
    const { MacroService } = await import('@/application/macro/macro-service.js');
    mockDb.macroSnapshot.findMany.mockResolvedValue([
      { indicatorCode: 'IPC_NACIONAL', value: '4.2', effectiveDate: new Date('2026-06-30') },
    ]);

    const svc = new MacroService(mockDb as never);
    const res = await svc.cumulativeInflation(new Date('2026-06-01'), new Date('2026-06-30'));

    expect(res!.deltaPct).toBe(4.2);
    expect(res!.monthsUsed).toBe(1);
  });
});
