import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: { companyTargetBudget: { findMany: vi.fn() } },
}));

vi.mock('@/infrastructure/database/prisma.js', () => ({ prisma: mockPrisma }));

const { BenchmarkService } = await import('@/application/benchmarks/benchmark-service.js');

function budget(overrides: Partial<{ rawMaterialsPct: number; laborPct: number; cifPct: number; marginPct: number }> = {}) {
  return { rawMaterialsPct: 40, laborPct: 20, cifPct: 15, marginPct: 25, ...overrides };
}

beforeEach(() => vi.clearAllMocks());

/**
 * Hallazgo de la auditoría de aislamiento (2026-07-29): con una sola empresa
 * en el rubro, el "promedio" devuelto ES el dato confidencial de esa empresa.
 * Se agrega un piso de muestra (MIN_SAMPLE_SIZE = 3) antes de calcular.
 */
describe('BenchmarkService — piso de k-anonimato por rubro', () => {
  it('devuelve null cuando hay menos de 3 empresas en el rubro (evita de-anonimizar)', async () => {
    mockPrisma.companyTargetBudget.findMany.mockResolvedValue([budget(), budget()]);

    const result = await new BenchmarkService().getIndustryBenchmark('TEXTIL');

    expect(result).toBeNull();
  });

  it('devuelve null con exactamente una empresa (el caso más grave)', async () => {
    mockPrisma.companyTargetBudget.findMany.mockResolvedValue([budget({ marginPct: 42 })]);

    const result = await new BenchmarkService().getIndustryBenchmark('TEXTIL');

    expect(result).toBeNull();
  });

  it('calcula el promedio cuando hay 3 o más empresas', async () => {
    mockPrisma.companyTargetBudget.findMany.mockResolvedValue([
      budget({ marginPct: 20 }),
      budget({ marginPct: 30 }),
      budget({ marginPct: 40 }),
    ]);

    const result = await new BenchmarkService().getIndustryBenchmark('TEXTIL');

    expect(result).not.toBeNull();
    expect(result!.sampleSize).toBe(3);
    expect(result!.marginPct).toBe(30);
  });

  it('el benchmark general también respeta el piso de muestra', async () => {
    mockPrisma.companyTargetBudget.findMany.mockResolvedValue([budget(), budget()]);

    const result = await new BenchmarkService().getGeneralBenchmark();

    expect(result).toBeNull();
  });
});
