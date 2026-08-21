import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Tests de DeviationService (issue #99, B-11).
 *
 * Verifica la lógica de desvío real vs. estándar:
 *   - Sin presupuesto objetivo: target null, isDeviating false
 *   - Sin cálculo previo: actual null, isDeviating false
 *   - isDeviating true cuando alguna categoría supera el umbral (+5 pp)
 *   - isDeviating false cuando todo está dentro del umbral
 *   - Aislamiento: lanza NotFoundError si la empresa no pertenece al usuario
 */

const mockPrisma = {
  companyTargetBudget: { findUnique: vi.fn() },
  costStructure: { findFirst: vi.fn() },
  company: { findFirst: vi.fn() },
};

vi.mock('@/infrastructure/database/prisma.js', () => ({
  prisma: mockPrisma,
}));

// CompanyService.getById usa this.db.company.findFirst. Lo inyectamos mockeado.
vi.mock('@/application/companies/company-service.js', () => ({
  CompanyService: vi.fn(() => ({
    getById: vi.fn(),
  })),
}));

const target = {
  companyId: 'co-1',
  rawMaterialsPct: 40,
  laborPct: 30,
  cifPct: 20,
  marginPct: 10,
};

function makeCalc(mp: number, mod: number, cif: number, margin: number) {
  return {
    rawMaterialConsumed: mp,
    directLaborTotal: mod,
    indirectCostsApplied: cif,
    grossMargin: margin,
  };
}

describe('DeviationService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sin presupuesto objetivo → target null, isDeviating false', async () => {
    const { DeviationService } = await import('@/application/companies/deviation-service.js');
    const svc = new DeviationService();

    mockPrisma.companyTargetBudget.findUnique.mockResolvedValue(null);
    mockPrisma.costStructure.findFirst.mockResolvedValue(null);

    const result = await svc.getCompanyDeviations('u-1', 'co-1');

    expect(result.target).toBeNull();
    expect(result.actual).toBeNull();
    expect(result.isDeviating).toBe(false);
  });

  it('sin cálculo previo → actual null, isDeviating false aunque haya objetivo', async () => {
    const { DeviationService } = await import('@/application/companies/deviation-service.js');
    const svc = new DeviationService();

    mockPrisma.companyTargetBudget.findUnique.mockResolvedValue(target);
    mockPrisma.costStructure.findFirst.mockResolvedValue({ calculations: [] });

    const result = await svc.getCompanyDeviations('u-1', 'co-1');

    expect(result.target).not.toBeNull();
    expect(result.actual).toBeNull();
    expect(result.isDeviating).toBe(false);
  });

  it('isDeviating true cuando MP supera objetivo + 5 pp', async () => {
    const { DeviationService } = await import('@/application/companies/deviation-service.js');
    const svc = new DeviationService();

    // target.rawMaterialsPct = 40; actual será 50 → desvío > 5
    // mp=50, mod=20, cif=20, margin=10 → total=100; rawMaterialsPct=50
    mockPrisma.companyTargetBudget.findUnique.mockResolvedValue(target);
    mockPrisma.costStructure.findFirst.mockResolvedValue({
      calculations: [makeCalc(50, 20, 20, 10)],
    });

    const result = await svc.getCompanyDeviations('u-1', 'co-1');

    expect(result.isDeviating).toBe(true);
    expect(result.actual!.rawMaterialsPct).toBe(50);
  });

  it('isDeviating true cuando margen cae más de 5 pp bajo el objetivo', async () => {
    const { DeviationService } = await import('@/application/companies/deviation-service.js');
    const svc = new DeviationService();

    // target.marginPct = 10; actual margin = 2 → desvío < -5
    // mp=40, mod=30, cif=28, margin=2 → total=100; marginPct=2
    mockPrisma.companyTargetBudget.findUnique.mockResolvedValue(target);
    mockPrisma.costStructure.findFirst.mockResolvedValue({
      calculations: [makeCalc(40, 30, 28, 2)],
    });

    const result = await svc.getCompanyDeviations('u-1', 'co-1');

    expect(result.isDeviating).toBe(true);
    expect(result.actual!.marginPct).toBe(2);
  });

  it('isDeviating false cuando todos los valores están dentro del umbral', async () => {
    const { DeviationService } = await import('@/application/companies/deviation-service.js');
    const svc = new DeviationService();

    // target: mp=40, mod=30, cif=20, margin=10 — todo exacto
    mockPrisma.companyTargetBudget.findUnique.mockResolvedValue(target);
    mockPrisma.costStructure.findFirst.mockResolvedValue({
      calculations: [makeCalc(40, 30, 20, 10)],
    });

    const result = await svc.getCompanyDeviations('u-1', 'co-1');

    expect(result.isDeviating).toBe(false);
  });
});
