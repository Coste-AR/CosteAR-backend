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
    // Valor anterior de la sección (para la auditoría) y valor nuevo (para el
    // versionado append-only, R1).
    let oldValue: unknown;
    let newValue: object;
    if (section === 'rawMaterial') {
      oldValue = before.rawMaterialConfig;
      // Acepta la MP única legada o N materias primas; guarda normalizado.
      newValue = rawMaterialSectionSchema.parse(rawConfig) as object;
      data.rawMaterialConfig = newValue;
    } else if (section === 'directLabor') {
      oldValue = before.directLaborConfig;
      newValue = directLaborConfigSchema.parse(rawConfig) as object;
      data.directLaborConfig = newValue;
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
      newValue = parsed as object;
      data.indirectCostConfig = newValue;
    }

    // R1 + R2: versión append-only de la config + update del puntero vigente +
    // auditoría, TODO en la misma transacción.
    return this.db.$transaction(async (tx) => {
      await this.appendConfigVersion(tx, id, section, newValue, userId);
      const updated = await tx.costStructure.update({ where: { id }, data });
      await recordAudit(
        {
          ...ctx,
          userId,
          action: `cost_structure.config.${section}`,
          entityType: 'CostStructure',
          entityId: id,
          oldValue,
          newValue,
        },
        tx,
      );
      return updated;
    });
  }

  /**
   * Inserta una versión append-only de una sección de config (R1). Calcula el
   * próximo `versionN` para (estructura, sección) y NUNCA pisa lo anterior — un
   * trigger de DB bloquea cualquier UPDATE/DELETE sobre esta tabla.
   */
  private async appendConfigVersion(
    tx: Prisma.TransactionClient,
    structureId: string,
    section: string,
    value: object,
    userId: string,
    reason?: string,
  ) {
    const last = await tx.costConfigVersion.findFirst({
      where: { structureId, section },
      orderBy: { versionN: 'desc' },
      select: { versionN: true },
    });
    await tx.costConfigVersion.create({
      data: {
        structureId,
        section,
        versionN: (last?.versionN ?? 0) + 1,
        value: value as Prisma.InputJsonValue,
        createdBy: userId,
        reason,
      },
    });
  }

  /** Historial append-only de una sección de config (R1). Más nueva primero. */
  async getConfigHistory(userId: string, id: string, section?: string) {
    await this.requireStructure(userId, id);
    return this.db.costConfigVersion.findMany({
      where: { structureId: id, ...(section ? { section } : {}) },
      orderBy: [{ section: 'asc' }, { versionN: 'desc' }],
    });
  }

  async updateSales(userId: string, id: string, unitPrice: number, quantity: number, ctx: AuditContext) {
    const before = await this.requireStructure(userId, id);
    return this.db.$transaction(async (tx) => {
      await this.appendConfigVersion(tx, id, 'sales', { salesUnitPrice: unitPrice, salesQuantity: quantity }, userId);
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
