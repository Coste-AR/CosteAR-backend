import type { PrismaClient } from '@prisma/client';
import { prisma, withTenant } from '../../infrastructure/database/prisma.js';
import { recordTraceAudit, type TraceActor } from '../audit/trace-audit.js';
import { ConflictError, NotFoundError } from '../../domain/errors/domain-error.js';
import type { ProduccionDiariaCreateInput } from '../../shared/schemas/produccion-diaria.schema.js';
import { revisionProduccion, saldoVivo } from '../../domain/operacion/revision-carga-campo.js';

const inicioDelDia = (fecha: string) => new Date(`${fecha}T00:00:00.000Z`);

/**
 * Producción diaria e indicadores de postura (A-11). La producción se ingresa
 * como hecho por variante; los porcentajes se calculan desde eventos y jamás
 * se persisten para evitar que haya un segundo valor editable.
 */
export class ProduccionDiariaService {
  constructor(private readonly db: PrismaClient = prisma) {}

  private async loteDe(userId: string, loteId: string) {
    const lote = await withTenant(userId, (tx) =>
      tx.loteProductivo.findFirst({ where: { id: loteId, userId, deletedAt: null } }),
    );
    if (!lote) throw new NotFoundError('Lote productivo no encontrado');
    return lote;
  }

  async create(
    userId: string,
    loteId: string,
    input: ProduccionDiariaCreateInput,
    actor: TraceActor,
  ) {
    const lote = await this.loteDe(userId, loteId);
    const fecha = inicioDelDia(input.fecha);
    return withTenant(userId, async (tx) => {
      const eventos = await tx.eventoLote.findMany({
        where: { companyId: lote.companyId, loteId, fecha: { lte: fecha }, deletedAt: null },
      });
      const revision = revisionProduccion(input.unidadesProducidas, saldoVivo(eventos));
      const existente = await tx.produccionDiaria.findFirst({
        where: { companyId: lote.companyId, loteId, fecha, variante: input.variante, deletedAt: null },
      });
      if (existente) {
        throw new ConflictError('Ya hay producción cargada para esa fecha y variante');
      }
      const creado = await tx.produccionDiaria.create({
        data: {
          companyId: lote.companyId,
          userId,
          loteId,
          fecha,
          variante: input.variante,
          unidadesProducidas: input.unidadesProducidas,
          roturas: input.roturas,
          descartes: input.descartes,
          ...revision,
        },
      });
      await recordTraceAudit(
        {
          entityType: 'ProduccionDiaria',
          entityId: creado.id,
          action: 'create',
          actor,
          after: creado,
          comment: `Producción diaria registrada: ${input.variante}`,
        },
        tx,
      );
      return creado;
    });
  }

  async list(userId: string, loteId: string, fecha?: string) {
    await this.loteDe(userId, loteId);
    return withTenant(userId, (tx) =>
      tx.produccionDiaria.findMany({
        where: { loteId, deletedAt: null, ...(fecha && { fecha: inicioDelDia(fecha) }) },
        orderBy: [{ fecha: 'desc' }, { variante: 'asc' }],
      }),
    );
  }

  private async vivosAlDia(userId: string, companyId: string, fecha: Date, loteId?: string) {
    const eventos = await withTenant(userId, (tx) =>
      tx.eventoLote.findMany({
        where: {
          companyId,
          deletedAt: null,
          fecha: { lte: fecha },
          ...(loteId && { loteId }),
        },
      }),
    );
    return saldoVivo(eventos);
  }

  /**
   * Expone siempre ambos nombres: el denominador de lote y el de plantel son
   * distintos. Null con inconsistencia evita presentar una división por cero
   * como si fuera un porcentaje real.
   */
  async indicadores(userId: string, loteId: string, fechaIso: string) {
    const lote = await this.loteDe(userId, loteId);
    const fecha = inicioDelDia(fechaIso);
    const [produccionLote, produccionPlantel, avesLote, avesPlantel] = await Promise.all([
      withTenant(userId, (tx) =>
        tx.produccionDiaria.findMany({ where: { loteId, fecha, deletedAt: null } }),
      ),
      withTenant(userId, (tx) =>
        tx.produccionDiaria.findMany({ where: { companyId: lote.companyId, fecha, deletedAt: null } }),
      ),
      this.vivosAlDia(userId, lote.companyId, fecha, loteId),
      this.vivosAlDia(userId, lote.companyId, fecha),
    ]);
    const unidadesLote = produccionLote.reduce((total, item) => total + Number(item.unidadesProducidas), 0);
    const unidadesPlantel = produccionPlantel.reduce((total, item) => total + Number(item.unidadesProducidas), 0);
    const inconsistente = unidadesLote > 0 && avesLote <= 0;
    return {
      posturaPorLote: avesLote > 0 ? unidadesLote / avesLote : null,
      posturaDePlantel: avesPlantel > 0 ? unidadesPlantel / avesPlantel : null,
      inconsistencia: inconsistente
        ? { code: 'PRODUCCION_SIN_ANIMALES_VIVOS', message: 'Hay producción cargada sin animales vivos en el lote' }
        : null,
    };
  }
}
