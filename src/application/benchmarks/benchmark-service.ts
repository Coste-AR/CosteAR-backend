import { prisma } from '../../infrastructure/database/prisma.js';

export interface BenchmarkStats {
  sampleSize: number;
  rawMaterialsPct: number;
  laborPct: number;
  cifPct: number;
  marginPct: number;
}

/**
 * Mínimo de empresas para mostrar un "promedio" de rubro. Sin este piso, con
 * una sola empresa en el rubro el "promedio" ES el dato confidencial de esa
 * empresa puntual — cualquier costista que conozca/adivine el rubro de otro
 * puede leer sus presupuestos objetivo. Hallazgo de la auditoría de
 * aislamiento (2026-07-29).
 */
const MIN_SAMPLE_SIZE = 3;

export class BenchmarkService {
  async getIndustryBenchmark(industry: string): Promise<BenchmarkStats | null> {
    const budgets = await prisma.companyTargetBudget.findMany({
      where: {
        company: { industry },
      },
    });

    if (budgets.length < MIN_SAMPLE_SIZE) return null;

    return this.calculateAverages(budgets);
  }

  async getGeneralBenchmark(): Promise<BenchmarkStats | null> {
    const budgets = await prisma.companyTargetBudget.findMany();

    if (budgets.length < MIN_SAMPLE_SIZE) return null;

    return this.calculateAverages(budgets);
  }

  private calculateAverages(budgets: Array<{
    rawMaterialsPct: number | null;
    laborPct: number | null;
    cifPct: number | null;
    marginPct: number | null;
  }>): BenchmarkStats {
    let raw = 0, labor = 0, cif = 0, margin = 0;
    let countRaw = 0, countLabor = 0, countCif = 0, countMargin = 0;

    for (const b of budgets) {
      if (b.rawMaterialsPct !== null) { raw += b.rawMaterialsPct; countRaw++; }
      if (b.laborPct !== null) { labor += b.laborPct; countLabor++; }
      if (b.cifPct !== null) { cif += b.cifPct; countCif++; }
      if (b.marginPct !== null) { margin += b.marginPct; countMargin++; }
    }

    return {
      sampleSize: budgets.length,
      rawMaterialsPct: countRaw > 0 ? Math.round(raw / countRaw) : 0,
      laborPct: countLabor > 0 ? Math.round(labor / countLabor) : 0,
      cifPct: countCif > 0 ? Math.round(cif / countCif) : 0,
      marginPct: countMargin > 0 ? Math.round(margin / countMargin) : 0,
    };
  }
}
