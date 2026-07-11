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
import {
  runCalculation,
  computeProductiveBudgets,
  buildCalculationTree,
  type CalculationInput,
  type CalcNode,
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
    const updated = await this.db.costStructure.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    await recordAudit(
      { ...ctx, userId, action: 'cost_structure.delete', entityType: 'CostStructure', entityId: id },
      this.db,
    );
    return updated;
  }

  /** Recupera una estructura que estaba en la papelera. */
  async restore(userId: string, id: string, ctx: AuditContext) {
    await this.requireStructure(userId, id);
    const updated = await this.db.costStructure.update({
      where: { id },
      data: { deletedAt: null },
    });
    await recordAudit(
      { ...ctx, userId, action: 'cost_structure.restore', entityType: 'CostStructure', entityId: id },
      this.db,
    );
    return updated;
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
    const tree = buildCalculationTree(input, result);

    const lastRun = await this.db.calculationRun.findFirst({
      where: { structureId: id },
      orderBy: { runN: 'desc' }
    });
    const runN = (lastRun?.runN ?? 0) + 1;

    // Flatten tree for Prisma createMany
    type FlatNode = {
      id: string;
      runId: string;
      parentId: string | null;
      ord: number;
      label: string;
      formula: string | null;
      valueNum: number | null;
      unit: string | null;
      sourceDpVersionIds: string[];
    };
    
    // We will save CalculationRun and then CalculationNodes.
    // However, nodes have parentId referencing other nodes, so we need to save them in order or generate UUIDs here.
    const { v4: uuidv4 } = await import('uuid');
    
    const calculation = await this.db.calculationRun.create({
      data: {
        costStructureId: id,
        results: result as any, // Store full CalculationResult
        executedAt: new Date(),
        runN,
        structureId: id,
        engineVersion: 'v1.1',
        executedBy: userId,
        inputsSnapshot: input as object,
      },
    });

    const runId = calculation.id;
    const flatNodes: FlatNode[] = [];
    
    function flatten(nodes: CalcNode[], parentId: string | null) {
      for (const node of nodes) {
        const nodeId = uuidv4();
        flatNodes.push({
          id: nodeId,
          runId,
          parentId,
          ord: node.ord,
          label: node.label,
          formula: node.formula || null,
          valueNum: node.valueNum || null,
          unit: node.unit || null,
          sourceDpVersionIds: node.sourceDpVersionIds || []
        });
        if (node.children && node.children.length > 0) {
          flatten(node.children, nodeId);
        }
      }
    }
    
    flatten(tree, null);
    
    // Prisma does not guarantee order in createMany, but since we flat the array
    // with generated UUIDs beforehand, the relations will wire up correctly.
    // However, SQLite/Postgres might complain about foreign key constraints if parents aren't inserted first.
    // Given Prisma's constraints, we might have to insert in batches by depth, or defer constraints.
    // For simplicity, createMany is used here. If constraint fails, we'd need sequential creates.
    // Since we generate UUIDs, the parent ID is known before insert.
    try {
      await this.db.calculationNode.createMany({
        data: flatNodes.map(n => ({
          id: n.id,
          runId: n.runId,
          parentId: n.parentId,
          ord: n.ord,
          label: n.label,
          formula: n.formula,
          valueNum: n.valueNum,
          unit: n.unit,
          sourceDpVersionIds: n.sourceDpVersionIds
        }))
      });
    } catch (e) {
      // If constraint fails, fallback to sequential
      for (const n of flatNodes) {
        await this.db.calculationNode.create({
          data: {
            id: n.id,
            runId: n.runId,
            parentId: n.parentId,
            ord: n.ord,
            label: n.label,
            formula: n.formula,
            valueNum: n.valueNum,
            unit: n.unit,
            sourceDpVersionIds: n.sourceDpVersionIds
          }
        });
      }
    }

    await recordAudit(
      { ...ctx, userId, action: 'cost_structure.calculate', entityType: 'CostStructure', entityId: id },
      this.db,
    );

    return { calculation, result };
  }

  async latestCalculation(userId: string, id: string) {
    await this.requireStructure(userId, id);
    return this.db.calculationRun.findFirst({
      where: { structureId: id },
      orderBy: { executedAt: 'desc' },
    });
  }

  async calculationHistory(userId: string, id: string) {
    await this.requireStructure(userId, id);
    return this.db.calculationRun.findMany({
      where: { structureId: id },
      orderBy: { executedAt: 'desc' },
      take: 50,
    });
  }

  async getCalculationTree(userId: string, id: string, runId: string) {
    await this.requireStructure(userId, id);
    const run = await this.db.calculationRun.findFirst({
      where: { id: runId, structureId: id }
    });
    if (!run) throw new NotFoundError('Ejecución no encontrada');

    const flatNodes = await this.db.calculationNode.findMany({
      where: { runId },
      orderBy: { ord: 'asc' }
    });
    
    // Un-flatten
    const map = new Map<string, any>();
    const roots: any[] = [];
    
    for (const n of flatNodes) {
      map.set(n.id, { ...n, children: [] });
    }
    
    for (const n of flatNodes) {
      const node = map.get(n.id);
      if (n.parentId) {
        map.get(n.parentId)?.children.push(node);
      } else {
        roots.push(node);
      }
    }
    
    return { run, tree: roots };
  }

  async simulate(userId: string, id: string, shocks: { rawMaterial?: number, directLabor?: number, indirectCosts?: number, sales?: number }) {
    const s = await this.requireStructure(userId, id);

    if (!s.rawMaterialConfig || !s.directLaborConfig || !s.indirectCostConfig) {
      throw new ValidationError('La estructura está incompleta: cargá MP, MOD y CIP antes de simular');
    }

    const input: CalculationInput = {
      rawMaterial: rawMaterialConfigSchema.parse(s.rawMaterialConfig),
      directLabor: directLaborConfigSchema.parse(s.directLaborConfig),
      indirectCosts: indirectCostConfigSchema.parse(s.indirectCostConfig),
      inventory: inventorySchema.parse({}),
      sales: {
        unitPrice: s.salesUnitPrice ? Number(s.salesUnitPrice) : 0,
        quantity: s.salesQuantity ? Number(s.salesQuantity) : 0,
      },
    };

    if (shocks.rawMaterial) {
      const mul = 1 + shocks.rawMaterial;
      input.rawMaterial.wilson.unitCost *= mul;
      input.rawMaterial.initialStock.unitCost *= mul;
      input.rawMaterial.movements.forEach(m => m.unitCost = (m.unitCost ?? 0) * mul);
    }
    if (shocks.directLabor) {
      const mul = 1 + shocks.directLabor;
      input.directLabor.employees.forEach(e => e.grossSalary *= mul);
    }
    if (shocks.indirectCosts) {
      const mul = 1 + shocks.indirectCosts;
      input.indirectCosts.fixed.forEach(f => f.amount *= mul);
      input.indirectCosts.variable.forEach(v => v.amount *= mul);
    }
    if (shocks.sales) {
      const mul = 1 + shocks.sales;
      input.sales.unitPrice *= mul;
    }

    const result = runCalculation(input);
    return { result };
  }
}
