import type { Prisma, PrismaClient, TipoMovimientoInventario } from '@prisma/client';
import { Decimal } from 'decimal.js';
import { prisma, withTenant } from '../../infrastructure/database/prisma.js';
import { ConflictError, NotFoundError, UnprocessableEntityError } from '../../domain/errors/domain-error.js';
import { recordTraceAudit, type TraceActor } from '../audit/trace-audit.js';
import type { ArticuloCreateInput, MovimientoInventarioCreateInput } from '../../shared/schemas/inventario.schema.js';

class StockInsuficienteError extends UnprocessableEntityError { override readonly code = 'STOCK_INSUFICIENTE'; }
class CantidadOrigenExcedidaError extends UnprocessableEntityError { override readonly code = 'CANTIDAD_ORIGEN_EXCEDIDA'; }
type Db = PrismaClient;
type Tx = Prisma.TransactionClient;
const day = (value: string) => new Date(`${value}T00:00:00.000Z`);

export class InventarioService {
  constructor(private readonly db: Db = prisma) {}
  private run<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    if (this.db === prisma) return withTenant(userId, fn);
    return this.db.$transaction(fn as never) as Promise<T>;
  }

  async crearArticulo(userId: string, companyId: string, input: ArticuloCreateInput, actor: TraceActor) {
    return this.run(userId, async (tx) => {
      const company = await tx.company.findFirst({ where: { id: companyId, userId } });
      if (!company) throw new NotFoundError('Negocio no encontrado');
      const unidad = await tx.unidadMedida.findFirst({ where: { id: input.unidadId, companyId } });
      if (!unidad) throw new NotFoundError('Unidad no encontrada');
      if (await tx.articulo.findFirst({ where: { companyId, codigo: input.codigo } })) throw new ConflictError('Ya existe un artículo con ese código', { field: 'codigo' });
      const article = await tx.articulo.create({ data: { ...input, companyId, userId } });
      await recordTraceAudit({ entityType: 'Articulo', entityId: article.id, action: 'create', actor, after: article }, tx);
      return article;
    });
  }

  private valuation(movements: Array<{ tipo: TipoMovimientoInventario; cantidad: Prisma.Decimal | number; costoUnitario: Prisma.Decimal | number }>) {
    let qty = new Decimal(0); let value = new Decimal(0);
    for (const row of movements) {
      const amount = new Decimal(row.cantidad.toString());
      if (row.tipo === 'INGRESO' || row.tipo === 'AJUSTE') { qty = qty.plus(amount); value = value.plus(amount.times(row.costoUnitario.toString())); }
      else if (row.tipo === 'SALIDA') { qty = qty.minus(amount); value = value.minus(amount.times(row.costoUnitario.toString())); }
      else if (row.tipo === 'DEVOLUCION') { qty = qty.plus(amount); value = value.plus(amount.times(row.costoUnitario.toString())); }
    }
    return { qty, value, ppp: qty.isZero() ? new Decimal(0) : value.div(qty) };
  }

  async listar(userId: string, companyId: string) {
    return this.run(userId, async (tx) => {
      if (!await tx.company.findFirst({ where: { id: companyId, userId } })) throw new NotFoundError('Negocio no encontrado');
      const articles = await tx.articulo.findMany({ where: { companyId }, orderBy: { codigo: 'asc' }, include: { movimientos: { orderBy: [{ fecha: 'asc' }, { createdAt: 'asc' }] } } });
      return articles.map(({ movimientos, ...article }) => { const v = this.valuation(movimientos); return { ...article, saldoCantidad: v.qty.toNumber(), saldoValor: v.value.toNumber(), ppp: v.ppp.toNumber() }; });
    });
  }

  async registrar(userId: string, companyId: string, input: MovimientoInventarioCreateInput, actor: TraceActor) {
    return this.run(userId, async (tx) => {
      const company = await tx.company.findFirst({ where: { id: companyId, userId } });
      if (!company) throw new NotFoundError('Negocio no encontrado');
      const article = await tx.articulo.findFirst({ where: { id: input.articuloId, companyId } });
      if (!article) throw new NotFoundError('Artículo no encontrado');
      if (input.identidadExterna && input.documentoHash) {
        const imported = await tx.movimientoInventario.findFirst({ where: {
          companyId, identidadExterna: input.identidadExterna, documentoHash: input.documentoHash.toLowerCase(),
        } });
        if (imported) return imported;
      }
      if (input.depositoId && !await tx.deposito.findFirst({ where: { id: input.depositoId, companyId } })) throw new NotFoundError('Depósito no encontrado');
      if (input.tipo === 'SALIDA' && !input.ordenId) throw new UnprocessableEntityError('La salida requiere una orden de trabajo', { field: 'ordenId' });
      if (input.ordenId && !await tx.ordenTrabajo.findFirst({ where: { id: input.ordenId, companyId } })) throw new NotFoundError('Orden de trabajo no encontrada');
      if (input.ordenDestinoId && !await tx.ordenTrabajo.findFirst({ where: { id: input.ordenDestinoId, companyId } })) throw new NotFoundError('Orden de trabajo destino no encontrada');
      const previous = await tx.movimientoInventario.findMany({ where: { articuloId: article.id }, orderBy: [{ fecha: 'asc' }, { createdAt: 'asc' }] });
      const current = this.valuation(previous);
      const quantity = new Decimal(input.cantidad);
      if (input.tipo === 'SALIDA' && quantity.gt(current.qty)) throw new StockInsuficienteError(`La salida de ${quantity} supera el saldo disponible de ${current.qty}`);
      let unitCost: Decimal;
      let sourceOrderId = input.ordenId ?? null;
      if (input.tipo === 'DEVOLUCION' || input.tipo === 'TRANSFERENCIA') {
        if (!input.movimientoOrigenId) throw new UnprocessableEntityError('El movimiento requiere una salida de origen', { field: 'movimientoOrigenId' });
        const source = await tx.movimientoInventario.findFirst({ where: { id: input.movimientoOrigenId, companyId, articuloId: article.id, tipo: 'SALIDA' } });
        if (!source) throw new NotFoundError('Salida de origen no encontrada');
        const used = previous.filter((row) => row.movimientoOrigenId === source.id && (row.tipo === 'DEVOLUCION' || row.tipo === 'TRANSFERENCIA'))
          .reduce((sum, row) => sum.plus(row.cantidad.toString()), new Decimal(0));
        if (quantity.plus(used).gt(source.cantidad.toString())) throw new CantidadOrigenExcedidaError(`La cantidad supera las ${source.cantidad} unidades disponibles de la salida`);
        sourceOrderId = source.ordenId;
        if (!sourceOrderId) throw new UnprocessableEntityError('La salida de origen no tiene una orden de trabajo');
        if (input.tipo === 'TRANSFERENCIA') {
          if (!input.ordenDestinoId) throw new UnprocessableEntityError('La transferencia requiere una orden destino', { field: 'ordenDestinoId' });
          if (input.ordenDestinoId === sourceOrderId) throw new UnprocessableEntityError('La orden destino debe ser distinta de la orden origen', { field: 'ordenDestinoId' });
        }
        unitCost = input.tipo === 'DEVOLUCION' && company.politicaDevolucionInventario === 'PPP_VIGENTE'
          ? current.ppp : new Decimal(source.costoUnitario.toString());
      } else if (input.tipo === 'INGRESO') {
        if (input.costoUnitario === undefined) throw new UnprocessableEntityError('El ingreso requiere costo unitario', { field: 'costoUnitario' });
        unitCost = new Decimal(input.costoUnitario).plus(new Decimal(input.gastosCompra ?? 0).div(quantity));
      } else if (input.tipo === 'SALIDA') {
        if (company.politicaPpp === 'PERIODO') {
          const period = input.periodoImputado;
          const purchases = previous.filter((row) => row.tipo === 'INGRESO' && row.periodoImputado.toISOString().slice(0, 10) === period);
          const periodQty = purchases.reduce((sum, row) => sum.plus(row.cantidad.toString()), new Decimal(0));
          const periodValue = purchases.reduce((sum, row) => sum.plus(new Decimal(row.cantidad.toString()).times(row.costoUnitario.toString())), new Decimal(0));
          unitCost = periodQty.isZero() ? current.ppp : periodValue.div(periodQty);
        } else {
          unitCost = current.ppp;
        }
      } else {
        if (input.costoUnitario === undefined) throw new UnprocessableEntityError('El ajuste requiere costo unitario', { field: 'costoUnitario' });
        unitCost = new Decimal(input.costoUnitario);
      }
      const movement = await tx.movimientoInventario.create({ data: {
        companyId, userId, articuloId: article.id, depositoId: input.depositoId ?? null, tipo: input.tipo,
        cantidad: quantity.toString(), costoUnitario: unitCost.toDecimalPlaces(4).toString(), fecha: day(input.fecha),
        ordenId: sourceOrderId, ordenDestinoId: input.ordenDestinoId ?? null, movimientoOrigenId: input.movimientoOrigenId ?? null,
        documento: input.documento ?? null, periodoImputado: day(input.periodoImputado),
        identidadExterna: input.identidadExterna ?? null, documentoHash: input.documentoHash?.toLowerCase() ?? null,
      } });
      await recordTraceAudit({ entityType: 'MovimientoInventario', entityId: movement.id, action: 'create', actor, after: movement }, tx);
      return movement;
    });
  }
}
