import type { PrismaClient } from '@prisma/client';
import { ForbiddenError, NotFoundError } from '../../domain/errors/domain-error.js';
import { prisma, withTenant } from '../../infrastructure/database/prisma.js';
import type { TelemetriaPanelCreate } from '../../shared/schemas/telemetria-panel.schema.js';

interface ActorTelemetria {
  id: string;
  role: string;
}

export class TelemetriaPanelService {
  constructor(private readonly db: PrismaClient = prisma) {}

  private async resolverTenant(companyId: string, actor: ActorTelemetria): Promise<string> {
    if (actor.role === 'EMPRESA_ADMIN' || actor.role === 'EMPRESARIO') {
      const company = await this.db.company.findFirst({
        where: { id: companyId, userId: actor.id, deletedAt: null },
        select: { userId: true },
      });
      if (!company) throw new NotFoundError('Negocio no encontrado');
      return company.userId;
    }

    if (actor.role === 'EMPRESA_OPERATOR') {
      const membership = await this.db.operatorMembership.findFirst({
        where: {
          operatorId: actor.id,
          isActive: true,
          connection: { companyId },
        },
        select: { connection: { select: { costistId: true } } },
      });
      if (!membership) throw new ForbiddenError('No tenés acceso a ese negocio');
      return membership.connection.costistId;
    }

    throw new ForbiddenError('Tu rol no puede registrar telemetría del panel');
  }

  async registrar(companyId: string, actor: ActorTelemetria, input: TelemetriaPanelCreate) {
    const tenantId = await this.resolverTenant(companyId, actor);
    const event = await withTenant(tenantId, (tx) => tx.panelTelemetryEvent.create({
      data: {
        companyId,
        userId: tenantId,
        type: input.tipo,
        action: input.accion,
        durationMs: 'duracionMs' in input ? input.duracionMs : null,
        technicalRole: actor.role,
      },
    }));

    return {
      id: event.id,
      tipo: event.type,
      accion: event.action,
      duracionMs: event.durationMs,
      rolTecnico: event.technicalRole,
      registradoEn: event.createdAt.toISOString(),
    };
  }
}
