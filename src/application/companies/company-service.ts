import type { PrismaClient } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma.js';
import { recordAudit, type AuditContext } from '../audit/audit-logger.js';
import { ConflictError, NotFoundError } from '../../domain/errors/domain-error.js';
import type {
  CreateCompanyInput,
  UpdateCompanyInput,
} from '../../shared/schemas/company.schema.js';

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
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { costStructures: true } } },
    });
  }

  async getById(userId: string, id: string) {
    const company = await this.db.company.findFirst({ where: { id, userId } });
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
      },
    });
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

    const company = await this.db.company.update({
      where: { id },
      data: {
        name: input.name ?? existing.name,
        industry: input.industry ?? existing.industry,
        cuit: input.cuit ?? existing.cuit,
        description: input.description ?? existing.description,
        isActive: input.isActive ?? existing.isActive,
        periodicity: input.periodicity ?? existing.periodicity,
      },
    });
    await recordAudit(
      { ...ctx, userId, action: 'company.update', entityType: 'Company', entityId: id, oldValue: existing, newValue: company },
      this.db,
    );
    return company;
  }

  async remove(userId: string, id: string, ctx: AuditContext) {
    await this.getById(userId, id); // valida pertenencia
    await this.db.$transaction([
      this.db.processedCAE.deleteMany({ where: { companyId: id } }),
      this.db.costLedgerEntry.deleteMany({ where: { companyId: id } }),
      this.db.supplierFingerprint.deleteMany({ where: { companyId: id } }),
      this.db.company.delete({ where: { id } }),
    ]);
    await recordAudit(
      { ...ctx, userId, action: 'company.delete', entityType: 'Company', entityId: id },
      this.db,
    );
  }
}
