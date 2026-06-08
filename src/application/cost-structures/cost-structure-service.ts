import type { PrismaClient, Prisma } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma.js';
import { recordAudit, type AuditContext } from '../audit/audit-logger.js';
import { NotFoundError, ValidationError } from '../../domain/errors/domain-error.js';
import {
  rawMaterialConfigSchema,
  directLaborConfigSchema,
  indirectCostConfigSchema,
  inventorySchema,
  type CreateCostStructureInput,
} from '../../shared/schemas/cost.schema.js';
import { runCalculation, type CalculationInput } from './calculate.js';

/**
 * Gestión de estructuras de costos y ejecución de cálculos.
 *
 * Cada cálculo crea un registro INMUTABLE en CostCalculation, preservando la
 * trazabilidad histórica. La estructura referencia siempre al userId dueño de
 * la empresa (defensa en profundidad + RLS).
 */
export class CostStructureService {
  constructor(private readonly db: PrismaClient = prisma) {}

  private async requireCompany(userId: string, companyId: string) {
    const company = await this.db.company.findFirst({ where: { id: companyId, userId } });
    if (!company) throw new NotFoundError('Empresa no encontrada');
    return company;
  }

  async requireStructure(userId: string, id: string) {
    const structure = await this.db.costStructure.findFirst({ where: { id, userId } });
    if (!structure) throw new NotFoundError('Estructura de costos no encontrada');
    return structure;
  }

  async listByCompany(userId: string, companyId: string) {
    await this.requireCompany(userId, companyId);
    return this.db.costStructure.findMany({
      where: { companyId, userId },
      orderBy: { period: 'desc' },
    });
  }

  async create(userId: string, companyId: string, input: CreateCostStructureInput, ctx: AuditContext) {
    await this.requireCompany(userId, companyId);
    const structure = await this.db.costStructure.create({
      data: { companyId, userId, productName: input.productName, period: input.period },
    });
    await recordAudit(
      { ...ctx, userId, action: 'cost_structure.create', entityType: 'CostStructure', entityId: structure.id, newValue: input },
      this.db,
    );
    return structure;
  }

  /** Actualiza uno de los tres bloques de configuración (validado con Zod). */
  async updateConfig(
    userId: string,
    id: string,
    section: 'rawMaterial' | 'directLabor' | 'indirectCosts',
    rawConfig: unknown,
    ctx: AuditContext,
  ) {
    await this.requireStructure(userId, id);

    const data: Prisma.CostStructureUpdateInput = {};
    if (section === 'rawMaterial') {
      data.rawMaterialConfig = rawMaterialConfigSchema.parse(rawConfig) as object;
    } else if (section === 'directLabor') {
      data.directLaborConfig = directLaborConfigSchema.parse(rawConfig) as object;
    } else {
      data.indirectCostConfig = indirectCostConfigSchema.parse(rawConfig) as object;
    }

    const updated = await this.db.costStructure.update({ where: { id }, data });
    await recordAudit(
      { ...ctx, userId, action: `cost_structure.config.${section}`, entityType: 'CostStructure', entityId: id },
      this.db,
    );
    return updated;
  }

  async updateSales(userId: string, id: string, unitPrice: number, quantity: number, ctx: AuditContext) {
    await this.requireStructure(userId, id);
    const updated = await this.db.costStructure.update({
      where: { id },
      data: { salesUnitPrice: unitPrice, salesQuantity: quantity },
    });
    await recordAudit(
      { ...ctx, userId, action: 'cost_structure.sales.update', entityType: 'CostStructure', entityId: id },
      this.db,
    );
    return updated;
  }

  /**
   * Ejecuta el motor de cálculo sobre la configuración persistida y guarda un
   * snapshot inmutable. Devuelve el resultado.
   */
  async calculate(userId: string, id: string, ctx: AuditContext, inventoryOverride?: unknown) {
    const s = await this.requireStructure(userId, id);

    if (!s.rawMaterialConfig || !s.directLaborConfig || !s.indirectCostConfig) {
      throw new ValidationError(
        'La estructura está incompleta: cargá MP, MOD y CIP antes de calcular',
      );
    }

    const input: CalculationInput = {
      rawMaterial: rawMaterialConfigSchema.parse(s.rawMaterialConfig),
      directLabor: directLaborConfigSchema.parse(s.directLaborConfig),
      indirectCosts: indirectCostConfigSchema.parse(s.indirectCostConfig),
      inventory: inventorySchema.parse(inventoryOverride ?? {}),
      sales: {
        unitPrice: s.salesUnitPrice ? Number(s.salesUnitPrice) : 0,
        quantity: s.salesQuantity ? Number(s.salesQuantity) : 0,
      },
    };

    const result = runCalculation(input);

    const calculation = await this.db.costCalculation.create({
      data: {
        costStructureId: id,
        userId,
        rawMaterialConsumed: result.rawMaterialConsumed,
        directLaborTotal: result.directLaborTotal,
        indirectCostsApplied: result.indirectCostsApplied,
        productionCost: result.productionCost,
        costOfGoodsSold: result.costOfGoodsSold,
        grossMargin: result.grossMargin,
        grossMarginPct: result.grossMarginPct,
        detail: result.detail as object,
      },
    });

    await recordAudit(
      { ...ctx, userId, action: 'cost_structure.calculate', entityType: 'CostStructure', entityId: id },
      this.db,
    );

    return { calculation, result };
  }

  async latestCalculation(userId: string, id: string) {
    await this.requireStructure(userId, id);
    return this.db.costCalculation.findFirst({
      where: { costStructureId: id, userId },
      orderBy: { calculatedAt: 'desc' },
    });
  }

  async calculationHistory(userId: string, id: string) {
    await this.requireStructure(userId, id);
    return this.db.costCalculation.findMany({
      where: { costStructureId: id, userId },
      orderBy: { calculatedAt: 'desc' },
      take: 50,
    });
  }
}
