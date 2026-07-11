import type { PrismaClient, Prisma } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma.js';
import { recordAudit, type AuditContext } from '../audit/audit-logger.js';
import { NotFoundError, ValidationError } from '../../domain/errors/domain-error.js';
import {
  rawMaterialSectionSchema,
  directLaborConfigSchema,
  indirectCostConfigSchema,
  inventorySchema,
  type CreateCostStructureInput,
} from '../../shared/schemas/cost.schema.js';
import {
  runCalculation,
  computeProductiveBudgets,
  type CalculationInput,
} from './calculate.js';

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

  async listByCompany(userId: string, companyId: string, includeDeleted = false) {
    await this.requireCompany(userId, companyId);
    return this.db.costStructure.findMany({
      where: { companyId, userId, ...(includeDeleted ? {} : { deletedAt: null }) },
      orderBy: [{ deletedAt: 'asc' }, { period: 'desc' }],
    });
  }

  /** Soft-delete: manda la estructura a la papelera (recuperable). */
  async softDelete(userId: string, id: string, ctx: AuditContext) {
    await this.requireStructure(userId, id);
    // R2: mutación + auditoría en la MISMA transacción (rollback conjunto).
    return this.db.$transaction(async (tx) => {
      const updated = await tx.costStructure.update({
        where: { id },
        data: { deletedAt: new Date() },
      });
      await recordAudit(
        { ...ctx, userId, action: 'cost_structure.delete', entityType: 'CostStructure', entityId: id },
        tx,
      );
      return updated;
    });
  }

  /** Recupera una estructura que estaba en la papelera. */
  async restore(userId: string, id: string, ctx: AuditContext) {
    await this.requireStructure(userId, id);
    return this.db.$transaction(async (tx) => {
      const updated = await tx.costStructure.update({
        where: { id },
        data: { deletedAt: null },
      });
      await recordAudit(
        { ...ctx, userId, action: 'cost_structure.restore', entityType: 'CostStructure', entityId: id },
        tx,
      );
      return updated;
    });
  }

  async getById(userId: string, id: string) {
    return this.requireStructure(userId, id);
  }

  /** Genera el .xlsx de la estructura (datos + Estado de Costos). */
  async exportToExcel(userId: string, id: string): Promise<{ buffer: Buffer; filename: string }> {
    const s = await this.db.costStructure.findFirst({
      where: { id, userId },
      include: { company: true },
    });
    if (!s) throw new NotFoundError('Estructura de costos no encontrada');
    if (!s.rawMaterialConfig || !s.directLaborConfig || !s.indirectCostConfig) {
      throw new ValidationError('Cargá MP, MOD y CIP antes de exportar');
    }

    const { exportCostStructureToXlsx } = await import('./excel-export.js');
    const buffer = await exportCostStructureToXlsx({
      productName: s.productName,
      period: s.period,
      companyName: s.company.name,
      rawMaterialConfig: s.rawMaterialConfig,
      directLaborConfig: s.directLaborConfig,
      indirectCostConfig: s.indirectCostConfig,
      salesUnitPrice: s.salesUnitPrice ? Number(s.salesUnitPrice) : 0,
      salesQuantity: s.salesQuantity ? Number(s.salesQuantity) : 0,
    });
    const safeName = `${s.company.name}-${s.productName}-${s.period}`
      .replace(/[^a-zA-Z0-9-]/g, '_')
      .slice(0, 80);
    return { buffer, filename: `CosteAR-${safeName}.xlsx` };
  }

  async create(userId: string, companyId: string, input: CreateCostStructureInput, ctx: AuditContext) {
    await this.requireCompany(userId, companyId);
    return this.db.$transaction(async (tx) => {
      const structure = await tx.costStructure.create({
        data: { companyId, userId, productName: input.productName, period: input.period },
      });
      await recordAudit(
        { ...ctx, userId, action: 'cost_structure.create', entityType: 'CostStructure', entityId: structure.id, newValue: input },
        tx,
      );
      return structure;
    });
  }

  /** Actualiza uno de los tres bloques de configuración (validado con Zod). */
  async updateConfig(
    userId: string,
    id: string,
    section: 'rawMaterial' | 'directLabor' | 'indirectCosts',
    rawConfig: unknown,
    ctx: AuditContext,
  ) {
    const before = await this.requireStructure(userId, id);

    const data: Prisma.CostStructureUpdateInput = {};
    // Valor anterior de la sección (para la auditoría). Hasta que la fuente de
    // verdad sea append-only, guardar el `oldValue` en la bitácora es la red de
    // seguridad ante el UPDATE del JSONB (mitiga R1 — ver AUDITORIA-MAXIMA §3).
    let oldValue: unknown;
    if (section === 'rawMaterial') {
      oldValue = before.rawMaterialConfig;
      // Acepta la MP única legada o N materias primas; guarda normalizado.
      data.rawMaterialConfig = rawMaterialSectionSchema.parse(rawConfig) as object;
    } else if (section === 'directLabor') {
      oldValue = before.directLaborConfig;
      data.directLaborConfig = directLaborConfigSchema.parse(rawConfig) as object;
    } else {
      oldValue = before.indirectCostConfig;
      const parsed = indirectCostConfigSchema.parse(rawConfig);
      // Auto-completar el PRESUPUESTO de cada centro productivo con el resultado
      // del prorrateo (primario + cierre del secundario). El usuario nunca lo
      // tipea: queda en solo lectura en la UI. Si la config aún está incompleta
      // (p. ej. sin conceptos), se persiste tal cual y se completará al re-guardar.
      try {
        const budgets = computeProductiveBudgets(parsed);
        parsed.productiveSettings = parsed.productiveSettings.map((p) => ({
          ...p,
          budget: budgets[p.centerId] ?? p.budget ?? { fixed: 0, variable: 0 },
        }));
      } catch {
        /* config incompleta: se persiste sin recalcular el presupuesto */
      }
      data.indirectCostConfig = parsed as object;
    }

    // R2: update + auditoría en la MISMA transacción.
    return this.db.$transaction(async (tx) => {
      const updated = await tx.costStructure.update({ where: { id }, data });
      await recordAudit(
        {
          ...ctx,
          userId,
          action: `cost_structure.config.${section}`,
          entityType: 'CostStructure',
          entityId: id,
          oldValue,
          newValue: data[`${section === 'rawMaterial' ? 'rawMaterialConfig' : section === 'directLabor' ? 'directLaborConfig' : 'indirectCostConfig'}`],
        },
        tx,
      );
      return updated;
    });
  }

  async updateSales(userId: string, id: string, unitPrice: number, quantity: number, ctx: AuditContext) {
    const before = await this.requireStructure(userId, id);
    return this.db.$transaction(async (tx) => {
      const updated = await tx.costStructure.update({
        where: { id },
        data: { salesUnitPrice: unitPrice, salesQuantity: quantity },
      });
      await recordAudit(
        {
          ...ctx,
          userId,
          action: 'cost_structure.sales.update',
          entityType: 'CostStructure',
          entityId: id,
          oldValue: { salesUnitPrice: before.salesUnitPrice, salesQuantity: before.salesQuantity },
          newValue: { salesUnitPrice: unitPrice, salesQuantity: quantity },
        },
        tx,
      );
      return updated;
    });
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
      rawMaterial: rawMaterialSectionSchema.parse(s.rawMaterialConfig),
      directLabor: directLaborConfigSchema.parse(s.directLaborConfig),
      indirectCosts: indirectCostConfigSchema.parse(s.indirectCostConfig),
      inventory: inventorySchema.parse(inventoryOverride ?? {}),
      sales: {
        unitPrice: s.salesUnitPrice ? Number(s.salesUnitPrice) : 0,
        quantity: s.salesQuantity ? Number(s.salesQuantity) : 0,
      },
    };

    const result = runCalculation(input);

    const calculation = await this.db.$transaction(async (tx) => {
      const created = await tx.costCalculation.create({
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
        tx,
      );
      return created;
    });

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
