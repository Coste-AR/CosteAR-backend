import type { PrismaClient, TipoMovimientoDeposito } from '@prisma/client';
import { prisma, withTenant } from '../../infrastructure/database/prisma.js';
import { recordTraceAudit, type TraceActor } from '../audit/trace-audit.js';
import { NotFoundError, UnprocessableEntityError } from '../../domain/errors/domain-error.js';
import type { DepositoCreateInput, MovimientoDepositoCreateInput } from '../../shared/schemas/deposito.schema.js';

const tipoBase: Record<MovimientoDepositoCreateInput['tipo'], TipoMovimientoDeposito> = { ingreso: 'INGRESO', egreso: 'EGRESO' };
const dia = (fecha: string) => new Date(`${fecha}T00:00:00.000Z`);

export class DepositoService {
  constructor(private readonly db: PrismaClient = prisma) {}
  private async depositoDe(userId: string, depositoId: string) {
    const deposito = await withTenant(userId, (tx) => tx.deposito.findFirst({ where: { id: depositoId, userId, deletedAt: null } }));
    if (!deposito) throw new NotFoundError('Depósito no encontrado');
    return deposito;
  }
  async create(userId: string, companyId: string, input: DepositoCreateInput, actor: TraceActor) {
    const unidad = await withTenant(userId, (tx) => tx.unidadMedida.findFirst({ where: { id: input.unidadId, companyId, deletedAt: null } }));
    if (!unidad) throw new NotFoundError('Unidad de medida no encontrada');
    return withTenant(userId, async (tx) => {
      const creado = await tx.deposito.create({ data: { companyId, userId, ...input } });
      await recordTraceAudit({ entityType: 'Deposito', entityId: creado.id, action: 'create', actor, after: creado, comment: 'Depósito registrado' }, tx);
      return creado;
    });
  }
  async nivel(userId: string, depositoId: string) {
    const deposito = await this.depositoDe(userId, depositoId);
    const movimientos = await withTenant(userId, (tx) => tx.movimientoDeposito.findMany({ where: { depositoId } }));
    const nivel = movimientos.reduce((total, m) => total + (m.tipo === 'INGRESO' ? Number(m.cantidad) : -Number(m.cantidad)), 0);
    return { nivel, capacidad: Number(deposito.capacidad), umbralBajo: Number(deposito.umbralBajo), alertaNivelBajo: nivel <= Number(deposito.umbralBajo) };
  }
  async movimiento(userId: string, depositoId: string, input: MovimientoDepositoCreateInput, actor: TraceActor) {
    const deposito = await this.depositoDe(userId, depositoId);
    const actual = await this.nivel(userId, depositoId);
    if (input.tipo === 'egreso' && actual.nivel - input.cantidad < 0) {
      throw new UnprocessableEntityError('El egreso dejaría el nivel del depósito por debajo de cero', { field: 'cantidad' });
    }
    return withTenant(userId, async (tx) => {
      const creado = await tx.movimientoDeposito.create({ data: { companyId: deposito.companyId, userId, depositoId, tipo: tipoBase[input.tipo], cantidad: input.cantidad, fecha: dia(input.fecha) } });
      await recordTraceAudit({ entityType: 'MovimientoDeposito', entityId: creado.id, action: 'create', actor, after: creado, comment: `Movimiento de depósito: ${input.tipo}` }, tx);
      return creado;
    });
  }
}
