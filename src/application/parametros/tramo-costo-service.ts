import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma, withTenant } from '../../infrastructure/database/prisma.js';
import { NotFoundError, UnprocessableEntityError } from '../../domain/errors/domain-error.js';
import { calcularEquilibrioPorTramos } from '../../domain/calculations/tramos.js';
import type { GuardarTramoCostoInput } from '../../shared/schemas/tramo-costo.schema.js';
import { recordTraceAudit, type TraceActor } from '../audit/trace-audit.js';

export class TramoCostoService {
  constructor(private readonly db: PrismaClient = prisma) {}

  private async companyDe(userId: string, companyId: string) {
    const company = await this.db.company.findFirst({ where: { id: companyId, userId, deletedAt: null } });
    if (!company) throw new NotFoundError('Negocio no encontrado');
    return company;
  }

  private filasVigentes(db: PrismaClient | Prisma.TransactionClient, companyId: string) {
    return db.tramoCosto.findMany({ where: { companyId, deletedAt: null }, orderBy: [{ desde: 'asc' }, { createdAt: 'desc' }] });
  }

  async listar(userId: string, companyId: string) {
    await this.companyDe(userId, companyId);
    const filas = await this.filasVigentes(this.db, companyId);
    return filas.map((fila) => this.serializar(fila));
  }

  private serializar(fila: Prisma.TramoCostoGetPayload<Record<string, never>>) {
    return {
      id: fila.id, conceptoId: fila.conceptoId, segmentoId: fila.segmentoId,
      desde: fila.desde.toNumber(), hasta: fila.hasta?.toNumber() ?? null, tipo: fila.tipo,
      importeFijo: fila.importeFijo.toNumber(), cmUnitaria: fila.cmUnitaria.toNumber(),
      techoFisico: fila.techoFisico?.toNumber() ?? null, techoFuente: fila.techoFuente,
      techoDeclaradoEn: fila.techoDeclaradoEn?.toISOString() ?? null,
      techoDeclaradoPorId: fila.techoDeclaradoPorId, createdAt: fila.createdAt.toISOString(),
    };
  }

  async guardar(userId: string, companyId: string, input: GuardarTramoCostoInput, actor: TraceActor) {
    await this.companyDe(userId, companyId);
    return withTenant(userId, async (tx) => {
      if (input.conceptoId) {
        const concepto = await tx.conceptoCosteo.findFirst({ where: { id: input.conceptoId, companyId, deletedAt: null } });
        if (!concepto) throw new NotFoundError('Concepto de costeo no encontrado');
      }
      let anterior = null;
      if (input.reemplazaId) {
        anterior = await tx.tramoCosto.findFirst({ where: { id: input.reemplazaId, companyId, deletedAt: null } });
        if (!anterior) throw new NotFoundError('Tramo de costo vigente no encontrado');
        if (anterior.conceptoId !== (input.conceptoId ?? null) || anterior.segmentoId !== (input.segmentoId ?? null)) {
          throw new UnprocessableEntityError('La nueva versión debe conservar el concepto o segmento del tramo.', { field: 'reemplazaId' });
        }
        await tx.tramoCosto.update({ where: { id: anterior.id }, data: { deletedAt: new Date() } });
      }
      const ahora = new Date();
      const guardado = await tx.tramoCosto.create({ data: {
        companyId, userId,
        conceptoId: input.conceptoId ?? null,
        segmentoId: input.segmentoId ?? null,
        desde: input.desde,
        hasta: input.hasta ?? null,
        tipo: input.tipo,
        importeFijo: input.importeFijo,
        cmUnitaria: input.cmUnitaria,
        techoFisico: input.techoFisico ?? null,
        techoFuente: input.techoFuente ?? null,
        techoDeclaradoEn: input.techoFisico == null ? null : ahora,
        techoDeclaradoPorId: input.techoFisico == null ? null : actor.id,
        creadoPorUserId: actor.id,
      } });
      await recordTraceAudit({
        entityType: 'TramoCosto', entityId: guardado.id,
        action: anterior ? 'update' : 'create', actor,
        before: anterior ?? undefined, after: guardado,
        comment: anterior ? 'Nueva versión append-only del tramo de costo.' : 'Alta de tramo de costo.',
      }, tx);
      return this.serializar(guardado);
    });
  }

  async calcular(userId: string, companyId: string) {
    await this.companyDe(userId, companyId);
    const filas = await this.filasVigentes(this.db, companyId);
    return calcularEquilibrioPorTramos(filas.map((fila) => ({
      id: fila.id,
      desde: fila.desde.toNumber(),
      hasta: fila.hasta?.toNumber() ?? null,
      tipo: fila.tipo,
      importeFijo: fila.importeFijo.toNumber(),
      cmUnitaria: fila.cmUnitaria.toNumber(),
      techoFisico: fila.techoFisico?.toNumber() ?? null,
    })));
  }


  async calcularYGuardar(userId: string, companyId: string, actor: TraceActor) {
    await this.companyDe(userId, companyId);
    return withTenant(userId, async (tx) => {
      const filas = await this.filasVigentes(tx, companyId);
      const resultado = calcularEquilibrioPorTramos(filas.map((fila) => ({
        id: fila.id, desde: fila.desde.toNumber(), hasta: fila.hasta?.toNumber() ?? null,
        tipo: fila.tipo, importeFijo: fila.importeFijo.toNumber(), cmUnitaria: fila.cmUnitaria.toNumber(),
        techoFisico: fila.techoFisico?.toNumber() ?? null,
      })));
      const foto = await tx.equilibrioTramosCalculo.create({ data: {
        companyId, userId, tramoCostoIds: filas.map((fila) => fila.id),
        resultado: resultado as unknown as Prisma.InputJsonValue, creadoPorUserId: actor.id,
      } });
      await recordTraceAudit({
        entityType: 'EquilibrioTramosCalculo', entityId: foto.id, action: 'create', actor,
        after: { tramoCostoIds: foto.tramoCostoIds, resultado },
        comment: 'Cálculo de equilibrio guardado con las versiones exactas de tramo utilizadas.',
      }, tx);
      return { calculoId: foto.id, ...resultado };
    });
  }
}
