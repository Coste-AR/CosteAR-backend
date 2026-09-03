import { Decimal } from 'decimal.js';
import type { PrismaClient } from '@prisma/client';
import { prisma, withTenant } from '../../infrastructure/database/prisma.js';
import { recordTraceAudit, type TraceActor } from '../audit/trace-audit.js';
import { NotFoundError, UnprocessableEntityError } from '../../domain/errors/domain-error.js';
import type { VentaProductoCreateInput } from '../../shared/schemas/venta-producto.schema.js';

const inicioDelDia = (fecha: string) => new Date(`${fecha}T00:00:00.000Z`);

export class VentaProductoService {
  constructor(private readonly db: PrismaClient = prisma) {}

  private async estructuraDe(userId: string, structureId: string) {
    const structure = await withTenant(userId, (tx) =>
      tx.costStructure.findFirst({ where: { id: structureId, userId, deletedAt: null } }),
    );
    if (!structure) throw new NotFoundError('Estructura de costos no encontrada');
    return structure;
  }

  async create(userId: string, structureId: string, input: VentaProductoCreateInput, actor: TraceActor) {
    const structure = await this.estructuraDe(userId, structureId);
    return withTenant(userId, async (tx) => {
      const unidad = await tx.unidadMedida.findFirst({
        where: { id: input.unidadId, companyId: structure.companyId, deletedAt: null },
      });
      if (!unidad) throw new NotFoundError('Unidad de venta no encontrada');

      const venta = await tx.ventaProducto.create({
        data: { companyId: structure.companyId, userId, structureId, ...input, fecha: inicioDelDia(input.fecha) },
      });
      await recordTraceAudit(
        {
          entityType: 'VentaProducto',
          entityId: venta.id,
          action: 'create',
          actor,
          after: venta,
          comment: `Venta registrada por canal: ${input.canal}`,
        },
        tx,
      );
      return venta;
    });
  }

  async precioPromedio(userId: string, periodId: string, unidadId: string) {
    const period = await withTenant(userId, (tx) =>
      tx.costPeriod.findFirst({ where: { id: periodId, userId, deletedAt: null } }),
    );
    if (!period) throw new NotFoundError('Período no encontrado');

    return withTenant(userId, async (tx) => {
      const unidadSalida = await tx.unidadMedida.findFirst({
        where: { id: unidadId, companyId: period.companyId, deletedAt: null },
      });
      if (!unidadSalida) throw new NotFoundError('Unidad de venta no encontrada');
      const ventas = await tx.ventaProducto.findMany({
        where: {
          companyId: period.companyId,
          structureId: period.structureId,
          fecha: { gte: period.startDate, lte: period.endDate },
          deletedAt: null,
        },
        include: { unidad: { select: { id: true, baseId: true, factor: true } } },
      });
      const baseSalida = unidadSalida.baseId ?? unidadSalida.id;
      const resumen = (filas: typeof ventas) => {
        if (filas.length === 0) return { precioPromedio: null, cantidad: 0, sinVentas: true };
        let importe = new Decimal(0);
        let cantidadSalida = new Decimal(0);
        for (const venta of filas) {
          if ((venta.unidad.baseId ?? venta.unidad.id) !== baseSalida) {
            throw new UnprocessableEntityError('Las ventas no usan una unidad compatible con la solicitada');
          }
          importe = importe.plus(new Decimal(venta.cantidad).times(venta.precioUnitario));
          cantidadSalida = cantidadSalida.plus(new Decimal(venta.cantidad).times(venta.unidad.factor).dividedBy(unidadSalida.factor));
        }
        return { precioPromedio: importe.dividedBy(cantidadSalida).toDecimalPlaces(4).toNumber(), cantidad: cantidadSalida.toNumber(), sinVentas: false };
      };
      const canales = [...new Set(ventas.map((venta) => venta.canal))].sort();
      return {
        unidadId,
        general: resumen(ventas),
        porCanal: canales.map((canal) => ({ canal, ...resumen(ventas.filter((venta) => venta.canal === canal)) })),
      };
    });
  }
}
