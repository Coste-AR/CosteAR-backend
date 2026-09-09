import type { PrismaClient } from '@prisma/client';
import { prisma, withTenant } from '../../infrastructure/database/prisma.js';
import { recordTraceAudit, type TraceActor } from '../audit/trace-audit.js';
import { NotFoundError, UnprocessableEntityError } from '../../domain/errors/domain-error.js';
import { resolverParametro, type FilaParametro } from '../../domain/parametros/parametros-costeo.js';
import type { EgresoProductoCreateInput } from '../../shared/schemas/stock-producto.schema.js';

const inicioDelDia = (fecha: string) => new Date(`${fecha}T00:00:00.000Z`);
const isoDia = (fecha: Date) => fecha.toISOString().slice(0, 10);

function diasEntre(inicio: Date, fin: Date): number {
  return Math.max(0, Math.floor((Date.UTC(fin.getUTCFullYear(), fin.getUTCMonth(), fin.getUTCDate())
    - Date.UTC(inicio.getUTCFullYear(), inicio.getUTCMonth(), inicio.getUTCDate())) / 86_400_000));
}

/**
 * Stock terminado por partida. No hay tabla de saldo: cada respuesta se arma
 * desde ProduccionDiaria, sus pérdidas y los egresos que consumen esa partida.
 */
export class StockProductoService {
  constructor(private readonly db: PrismaClient = prisma) {}

  private async companyDe(userId: string, companyId: string) {
    const company = await withTenant(userId, (tx) => tx.company.findFirst({ where: { id: companyId, userId, deletedAt: null } }));
    if (!company) throw new NotFoundError('Empresa no encontrada');
    return company;
  }

  async stock(userId: string, companyId: string, alIso: string) {
    await this.companyDe(userId, companyId);
    const al = inicioDelDia(alIso);
    const [producciones, egresos, parametros] = await Promise.all([
      withTenant(userId, (tx) => tx.produccionDiaria.findMany({
        where: { companyId, deletedAt: null, fecha: { lte: al } },
        orderBy: [{ fecha: 'asc' }, { variante: 'asc' }],
      })),
      withTenant(userId, (tx) => tx.egresoProducto.findMany({
        where: { companyId, fecha: { lte: al } },
        select: { produccionId: true, cantidad: true },
      })),
      withTenant(userId, (tx) => tx.parametroCosteo.findMany({
        where: { companyId, deletedAt: null },
        select: { clave: true, valorNum: true, periodId: true, structureId: true, confirmado: true },
      })),
    ]);
    const vidaUtil = resolverParametro('vida_util_producto_dias', parametros.map((p): FilaParametro => ({
      ...p, valorNum: p.valorNum === null ? null : Number(p.valorNum),
    })), {});
    const egresosPorProduccion = new Map<string, number>();
    for (const egreso of egresos) {
      egresosPorProduccion.set(egreso.produccionId, (egresosPorProduccion.get(egreso.produccionId) ?? 0) + Number(egreso.cantidad));
    }
    const partidas = producciones.map((produccion) => {
      const unidadesDisponibles = Number(produccion.unidadesProducidas) - Number(produccion.roturas)
        - Number(produccion.descartes) - (egresosPorProduccion.get(produccion.id) ?? 0);
      const diasDeVida = diasEntre(produccion.fecha, al);
      return {
        partidaId: produccion.id,
        loteId: produccion.loteId,
        variante: produccion.variante,
        fechaProduccion: isoDia(produccion.fecha),
        unidadesDisponibles,
        diasDeVida,
        vencida: diasDeVida >= vidaUtil.valor,
      };
    }).filter((partida) => partida.unidadesDisponibles > 0);
    const porVariante = new Map<string, number>();
    for (const partida of partidas) {
      porVariante.set(partida.variante, (porVariante.get(partida.variante) ?? 0) + partida.unidadesDisponibles);
    }
    return {
      al: alIso,
      vidaUtilDias: vidaUtil.valor,
      vidaUtilOrigen: vidaUtil.origen,
      vidaUtilConfirmada: vidaUtil.confirmado,
      partidas,
      porVariante: [...porVariante.entries()].map(([variante, unidadesDisponibles]) => ({ variante, unidadesDisponibles })),
    };
  }

  async egresar(userId: string, produccionId: string, input: EgresoProductoCreateInput, actor: TraceActor) {
    const fecha = inicioDelDia(input.fecha);
    return withTenant(userId, async (tx) => {
      const produccion = await tx.produccionDiaria.findFirst({ where: { id: produccionId, userId, deletedAt: null } });
      if (!produccion) throw new NotFoundError('Partida de producción no encontrada');
      if (fecha < produccion.fecha) {
        throw new UnprocessableEntityError('El egreso no puede ser anterior a la producción', { field: 'fecha' });
      }
      const egresos = await tx.egresoProducto.findMany({ where: { produccionId } });
      const disponible = Number(produccion.unidadesProducidas) - Number(produccion.roturas) - Number(produccion.descartes)
        - egresos.reduce((total, egreso) => total + Number(egreso.cantidad), 0);
      if (input.cantidad > disponible) {
        throw new UnprocessableEntityError('El egreso supera el stock disponible de la partida', { field: 'cantidad' });
      }
      const creado = await tx.egresoProducto.create({
        data: { companyId: produccion.companyId, userId, produccionId, cantidad: input.cantidad, fecha },
      });
      await recordTraceAudit({
        entityType: 'EgresoProducto', entityId: creado.id, action: 'create', actor, after: creado,
        comment: 'Egreso de producto terminado registrado',
      }, tx);
      return creado;
    });
  }
}
