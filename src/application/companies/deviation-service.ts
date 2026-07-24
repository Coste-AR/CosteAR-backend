import { prisma } from '../../infrastructure/database/prisma.js';
import { CompanyService } from './company-service.js';

export interface DeviationReport {
  target: {
    rawMaterialsPct: number;
    laborPct: number;
    cifPct: number;
    marginPct: number;
  } | null;
  actual: {
    rawMaterialsPct: number;
    laborPct: number;
    cifPct: number;
    marginPct: number;
  } | null;
  isDeviating: boolean;
}

export class DeviationService {
  constructor(private readonly companies: CompanyService = new CompanyService()) {}

  async getCompanyDeviations(userId: string, companyId: string): Promise<DeviationReport> {
    await this.companies.getById(userId, companyId); // valida pertenencia

    const target = await prisma.companyTargetBudget.findUnique({
      where: { companyId },
    });

    const structure = await prisma.costStructure.findFirst({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
      include: {
        calculations: {
          orderBy: { calculatedAt: 'desc' },
          take: 1,
        }
      }
    });

    const calc = structure?.calculations[0];
    let actual = null;

    if (calc) {
      const mp = Number(calc.rawMaterialConsumed);
      const mod = Number(calc.directLaborTotal);
      const cif = Number(calc.indirectCostsApplied);
      const margin = Number(calc.grossMargin);
      
      const totalRevenue = mp + mod + cif + margin;

      if (totalRevenue > 0) {
        actual = {
          rawMaterialsPct: Math.round((mp / totalRevenue) * 100),
          laborPct: Math.round((mod / totalRevenue) * 100),
          cifPct: Math.round((cif / totalRevenue) * 100),
          marginPct: Math.round((margin / totalRevenue) * 100),
        };
      }
    }

    let isDeviating = false;
    if (target && actual) {
      if (actual.rawMaterialsPct > (target.rawMaterialsPct || 0) + 5) isDeviating = true;
      if (actual.laborPct > (target.laborPct || 0) + 5) isDeviating = true;
      if (actual.cifPct > (target.cifPct || 0) + 5) isDeviating = true;
      if (actual.marginPct < (target.marginPct || 0) - 5) isDeviating = true;
    }

    return {
      target: target ? {
        rawMaterialsPct: target.rawMaterialsPct || 0,
        laborPct: target.laborPct || 0,
        cifPct: target.cifPct || 0,
        marginPct: target.marginPct || 0,
      } : null,
      actual,
      isDeviating
    };
  }
}
