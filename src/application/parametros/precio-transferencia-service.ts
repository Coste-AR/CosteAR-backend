import type { Prisma } from '@prisma/client';
import { calcularPrecioTransferencia } from '../../domain/calculations/precio-transferencia.js';
import { NotFoundError, UnprocessableEntityError } from '../../domain/errors/domain-error.js';
import { withTenant } from '../../infrastructure/database/prisma.js';
import type { PrecioTransferenciaQuery } from '../../shared/schemas/precio-transferencia.schema.js';

type Fila = { criterio: 'MERCADO' | 'COSTO_VARIABLE' | 'PRECIO_EN_BLOQUE'; valor: Prisma.Decimal; unidad: string; segmentoDestino: {
  precioUnitario: Prisma.Decimal | null; costoVariableUnitario: Prisma.Decimal | null; costoFijoDirecto: Prisma.Decimal;
} };

export class PrecioTransferenciaService {
  async calcular(userId: string, companyId: string, query: PrecioTransferenciaQuery) {
    const company = await withTenant(userId, (tx) => tx.company.findFirst({ where: { id: companyId, userId, deletedAt: null }, select: { id: true } }));
    if (!company) throw new NotFoundError('Empresa no encontrada.');
    const periodo = await withTenant(userId, (tx) => tx.costPeriod.findFirst({ where: { companyId }, orderBy: { endDate: 'desc' }, select: { id: true } }));
    if (!periodo) throw new NotFoundError('No hay un período de costos para calcular los precios de transferencia.');
    const filas = await withTenant(userId, (tx) => tx.precioTransferencia.findMany({
      where: { companyId, periodId: periodo.id }, include: { segmentoDestino: { select: { precioUnitario: true, costoVariableUnitario: true, costoFijoDirecto: true } } },
    })) as Fila[];
    const costo = filas.find((fila) => fila.criterio === 'COSTO_VARIABLE');
    const mercado = filas.find((fila) => fila.criterio === 'MERCADO');
    if (!costo || !mercado) throw new UnprocessableEntityError('Declará los precios de transferencia a costo variable y a mercado para el período.', { field: 'criterio' });
    if (costo.segmentoDestino.precioUnitario === null || costo.segmentoDestino.costoVariableUnitario === null) {
      throw new UnprocessableEntityError('El segmento destino necesita precio y costo variable unitarios.', { field: 'segmentoDestinoId' });
    }
    return calcularPrecioTransferencia({
      precioVenta: Number(costo.segmentoDestino.precioUnitario), costoVariableSinTransferencia: Number(costo.segmentoDestino.costoVariableUnitario),
      costoFijo: Number(costo.segmentoDestino.costoFijoDirecto), transferenciaACostoVariable: Number(costo.valor),
      transferenciaAMercado: Number(mercado.valor), unidad: costo.unidad, criterioSolicitadoParaDecision: query.criterioDecision,
    });
  }
}
