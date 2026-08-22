import type { PrismaClient } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma.js';
import { recordAudit, type AuditContext } from '../audit/audit-logger.js';
import { ConflictError, NotFoundError } from '../../domain/errors/domain-error.js';
import type {
  CreateCompanyInput,
  UpdateCompanyInput,
} from '../../shared/schemas/company.schema.js';
import { PREDEFINED_INDUSTRIES } from '../../shared/schemas/company.schema.js';
import type { UpdateTargetBudgetInput } from '../../shared/schemas/target-budget.schema.js';

/**
 * Gestión de la cartera de PyMEs del costista.
 *
 * Toda query filtra explícitamente por `userId` (defensa en profundidad);
 * la RLS de PostgreSQL es la segunda barrera a nivel de base de datos.
 */
export class CompanyService {
  constructor(private readonly db: PrismaClient = prisma) {}

  async list(userId: string) {
    return this.db.company.findMany({
      where: { userId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { costStructures: true } } },
    });
  }

  async getById(userId: string, id: string) {
    const company = await this.db.company.findFirst({ where: { id, userId, deletedAt: null } });
    if (!company) throw new NotFoundError('Empresa no encontrada');
    return company;
  }

  async create(userId: string, input: CreateCompanyInput, ctx: AuditContext) {
    const company = await this.db.company.create({
      data: {
        userId,
        name: input.name,
        industry: input.industry ?? null,
        cuit: input.cuit ?? null,
        description: input.description ?? null,
        // Si no lo eligen, mensual: es el ritmo más común y el default de la DB.
        periodicity: input.periodicity ?? 'MONTHLY',
        // Si no la eligen, Responsable Inscripto: es el default de la columna y
        // el supuesto con el que costea todo el sistema (ver DECISIONES.md,
        // CL-09). Decide si el IVA de cada comprobante es costo o crédito fiscal.
        condicionIva: input.condicionIva ?? 'RESPONSABLE_INSCRIPTO',
      },
    });

    // Pipeline de aprendizaje (Fase 1): Si el rubro no es uno de los predefinidos y no está vacío,
    // es un rubro manual ingresado por el usuario ("Otro").
    // Disparamos una DailySignal inmediata para procesarlo.
    if (input.industry && !PREDEFINED_INDUSTRIES.includes(input.industry)) {
      await this.db.dailySignal.create({
        data: {
          type: 'IMPROVEMENT_REPORT',
          source: 'PIPELINE_NOCTURNO',
          status: 'PENDING',
          content: `Nuevo rubro detectado: ${input.industry}`,
          context: { action: 'NEW_INDUSTRY', industry: input.industry, companyId: company.id },
          userId,
        }
      });
    }

    await recordAudit(
      { ...ctx, userId, action: 'company.create', entityType: 'Company', entityId: company.id, newValue: input },
      this.db,
    );
    return company;
  }

  async update(userId: string, id: string, input: UpdateCompanyInput, ctx: AuditContext) {
    const existing = await this.getById(userId, id);

    // El ritmo de costeo no se cambia con la empresa en marcha. Los períodos ya abiertos
    // llevan un código que responde al ritmo viejo ("2026-07" es mensual; "2026-07-Q1" es
    // quincenal): cambiarlo dejaría a la empresa con períodos de dos ritmos distintos
    // conviviendo, y el arrastre de existencia de uno al siguiente dejaría de tener sentido.
    // Un cambio de ritmo es una decisión contable, no un campo más del formulario.
    if (input.periodicity && input.periodicity !== existing.periodicity) {
      const periods = await this.db.costPeriod.count({ where: { companyId: id } });
      if (periods > 0) {
        throw new ConflictError(
          'No se puede cambiar el ritmo de costeo: esta empresa ya tiene períodos abiertos o cerrados. ' +
            'El ritmo se elige al dar de alta la empresa, antes de cargar el primer período.',
        );
      }
    }

    // A diferencia del ritmo de costeo, la condición frente al IVA SÍ se puede
    // corregir con la empresa en marcha: el sistema la asume Responsable
    // Inscripto por defecto y la bandera `condicionIvaRevisar` existe justamente
    // para que alguien venga a arreglarla. Rige HACIA ADELANTE: las líneas del
    // libro mayor ya emitidas no se recalculan — son hechos con su comprobante
    // atrás, y reescribirlas sería una revaluación silenciosa de datos vivos.
    // Confirmar la condición apaga la bandera y su nota.
    const condicionCambia = !!input.condicionIva && input.condicionIva !== existing.condicionIva;
    const confirmaCondicion = !!input.condicionIva;

    const company = await this.db.company.update({
      where: { id },
      data: {
        name: input.name ?? existing.name,
        industry: input.industry ?? existing.industry,
        cuit: input.cuit ?? existing.cuit,
        description: input.description ?? existing.description,
        isActive: input.isActive ?? existing.isActive,
        periodicity: input.periodicity ?? existing.periodicity,
        condicionIva: input.condicionIva ?? existing.condicionIva,
        ...(confirmaCondicion
          ? { condicionIvaRevisar: false, condicionIvaRevisarNota: null, condicionIvaRevisarAt: null }
          : {}),
      },
    });

    // Cambiar la condición cambia cómo se costea todo lo que entre desde ahora.
    // Queda como señal para que el pipeline/el admin lo vean, no como un log.
    if (condicionCambia) {
      await this.db.dailySignal.create({
        data: {
          type: 'USER_CORRECTION',
          source: 'VALIDACIONES_CORRECCION',
          status: 'PENDING',
          content: `Condición frente al IVA corregida: ${existing.condicionIva} → ${input.condicionIva}`,
          context: {
            action: 'CONDICION_IVA_CONFIRMADA',
            companyId: id,
            anterior: existing.condicionIva,
            nueva: input.condicionIva,
          },
          userId,
        },
      });
    }
    await recordAudit(
      { ...ctx, userId, action: 'company.update', entityType: 'Company', entityId: id, oldValue: existing, newValue: company },
      this.db,
    );
    return company;
  }

  async remove(userId: string, id: string, ctx: AuditContext) {
    await this.getById(userId, id); // valida pertenencia
    await this.db.$transaction([
      // Soft delete: solo marcamos la empresa como eliminada, no borramos cascada
      this.db.company.update({ where: { id }, data: { deletedAt: new Date() } }),
    ]);
    await recordAudit(
      { ...ctx, userId, action: 'company.delete', entityType: 'Company', entityId: id },
      this.db,
    );
  }

  // --- Target Budget (Objetivos de la Empresa) ---

  async getTargetBudget(userId: string, companyId: string) {
    await this.getById(userId, companyId); // Validar pertenencia
    
    let budget = await this.db.companyTargetBudget.findUnique({
      where: { companyId }
    });

    // Crear por defecto si no existe
    if (!budget) {
      budget = await this.db.companyTargetBudget.create({
        data: { companyId }
      });
    }

    return budget;
  }

  async updateTargetBudget(userId: string, companyId: string, input: UpdateTargetBudgetInput, ctx: AuditContext) {
    await this.getById(userId, companyId); // Validar pertenencia

    const budget = await this.db.companyTargetBudget.upsert({
      where: { companyId },
      create: {
        companyId,
        rawMaterialsPct: input.rawMaterialsPct,
        laborPct: input.laborPct,
        cifPct: input.cifPct,
        marginPct: input.marginPct,
      },
      update: {
        rawMaterialsPct: input.rawMaterialsPct,
        laborPct: input.laborPct,
        cifPct: input.cifPct,
        marginPct: input.marginPct,
      }
    });

    await recordAudit(
      { ...ctx, userId, action: 'company.update_budget', entityType: 'CompanyTargetBudget', entityId: budget.id, newValue: input },
      this.db,
    );

    return budget;
  }
}
