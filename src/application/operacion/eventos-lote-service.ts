import type { MotivoBajaLote, PrismaClient, TipoEventoLote } from '@prisma/client';
import { prisma, withTenant } from '../../infrastructure/database/prisma.js';
import { recordTraceAudit, type TraceActor } from '../audit/trace-audit.js';
import { NotFoundError } from '../../domain/errors/domain-error.js';
import type { EventoLoteCreateInput } from '../../shared/schemas/eventos-lote.schema.js';

const A_BASE: Record<EventoLoteCreateInput['tipo'], TipoEventoLote> = {
  alta: 'ALTA',
  baja: 'BAJA',
};
const MOTIVO_A_BASE: Record<NonNullable<Extract<EventoLoteCreateInput, { tipo: 'baja' }>['motivo']>, MotivoBajaLote> = {
  mortalidad: 'MORTALIDAD',
  descarte: 'DESCARTE',
  canibalismo: 'CANIBALISMO',
  faena: 'FAENA',
};

/**
 * Registro y lectura derivada de la población de un lote (A-10).
 *
 * La separación importante es entre el hecho físico y su clasificación
 * contable: una baja sin motivo se muestra pendiente y no altera el saldo que
 * usarán futuros cálculos. Este servicio no invoca ni modifica el motor.
 */
export class EventosLoteService {
  constructor(private readonly db: PrismaClient = prisma) {}

  private async loteDe(userId: string, loteId: string) {
    // Esta lectura también toca una tabla con RLS: si se hiciera sobre el
    // cliente sin contexto, el rol de aplicación vería cero filas y devolvería
    // un 404 falso. La autenticación del lote debe recorrer el mismo camino
    // tenantizado que el alta y que el saldo.
    const lote = await withTenant(userId, (tx) =>
      tx.loteProductivo.findFirst({ where: { id: loteId, userId, deletedAt: null } }),
    );
    if (!lote) throw new NotFoundError('Lote productivo no encontrado');
    return lote;
  }

  async create(userId: string, loteId: string, input: EventoLoteCreateInput, actor: TraceActor) {
    const lote = await this.loteDe(userId, loteId);
    return withTenant(userId, async (tx) => {
      const creado = await tx.eventoLote.create({
        data: {
          companyId: lote.companyId,
          userId,
          loteId,
          tipo: A_BASE[input.tipo],
          cantidad: input.cantidad,
          // Prisma representa también una columna DATE con DateTime. Al fijar
          // UTC evitamos que el huso horario del servidor cambie el día que
          // eligió quien cargó el evento.
          fecha: new Date(`${input.fecha}T00:00:00.000Z`),
          motivo: input.tipo === 'baja' ? MOTIVO_A_BASE[input.motivo] : null,
        },
      });
      await recordTraceAudit(
        {
          entityType: 'EventoLote',
          entityId: creado.id,
          action: 'create',
          actor,
          after: creado,
          comment: `Evento de lote registrado: ${input.tipo}`,
        },
        tx,
      );
      return creado;
    });
  }

  /** Eventos vigentes, incluidos los que requieren completar el motivo. */
  async list(userId: string, loteId: string) {
    await this.loteDe(userId, loteId);
    return withTenant(userId, (tx) =>
      tx.eventoLote.findMany({
        where: { loteId, deletedAt: null },
        orderBy: [{ fecha: 'asc' }, { createdAt: 'asc' }],
      }),
    );
  }

  /**
   * Saldo derivado: altas menos bajas clasificadas. Ninguna persona carga este
   * número, y una baja sin motivo queda explícitamente fuera como pendiente.
   */
  async poblacion(userId: string, loteId: string) {
    const eventos = await this.list(userId, loteId);
    const pendientes = eventos.filter((evento) => evento.tipo === 'BAJA' && evento.motivo === null);
    const cantidadViva = eventos.reduce((saldo, evento) => {
      if (evento.tipo === 'ALTA') return saldo + Number(evento.cantidad);
      if (evento.motivo !== null) return saldo - Number(evento.cantidad);
      return saldo;
    }, 0);
    return { cantidadViva, pendientes };
  }
}
