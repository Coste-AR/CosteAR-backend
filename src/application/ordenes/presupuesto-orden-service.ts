import type { PrismaClient } from '@prisma/client';
import { prisma, withTenant } from '../../infrastructure/database/prisma.js';
import { ConflictError, NotFoundError, ValidationError } from '../../domain/errors/domain-error.js';
import { recordTraceAudit, type TraceActor } from '../audit/trace-audit.js';
import type { PresupuestoCreateInput, PresupuestoRevalidarInput } from '../../shared/schemas/presupuesto-orden.schema.js';
import { PAQUETE_CONSTRUCCION_MODULAR } from '../operacion/paquete-construccion-modular.js';

class InvalidBudgetStateError extends ValidationError { override readonly code = 'INVALID_BUDGET_STATE'; }
class ExpiredBudgetError extends ValidationError { override readonly code = 'BUDGET_EXPIRED'; }
class SameApproverError extends ValidationError { override readonly code = 'SAME_PREPARER_AND_APPROVER'; }

const asNumber = (value: unknown) => Number(value);
const utcDate = (value?: string) => value ? new Date(`${value}T00:00:00.000Z`) : new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z');

export class PresupuestoOrdenService {
  constructor(private readonly db: PrismaClient = prisma) {}

  private async ordenDe(userId: string, ordenId: string) {
    const orden = await withTenant(userId, (tx) => tx.ordenTrabajo.findFirst({ where: { id: ordenId, userId } }));
    if (!orden) throw new NotFoundError('Orden de trabajo no encontrada');
    return orden;
  }

  private async presupuestoDe(userId: string, id: string) {
    const presupuesto = await withTenant(userId, (tx) => tx.versionPresupuesto.findFirst({ where: { id, userId }, include: { renglones: true } }));
    if (!presupuesto) throw new NotFoundError('Presupuesto no encontrado');
    return presupuesto;
  }

  private async vigenciaDefault(userId: string, companyId: string) {
    const parametro = await withTenant(userId, (tx) => tx.parametroCosteo.findFirst({
      where: { companyId, userId, clave: 'vigencia_oferta_dias', structureId: null, periodId: null },
      orderBy: { createdAt: 'desc' },
    }));
    return parametro?.valorNum ? Number(parametro.valorNum) : PAQUETE_CONSTRUCCION_MODULAR.seedParameters[0].valor;
  }

  async create(userId: string, ordenId: string, input: PresupuestoCreateInput, actor: TraceActor) {
    const orden = await this.ordenDe(userId, ordenId);
    if (input.tipo === 'ADICIONAL' && !input.causaAdicional) throw new ValidationError('Un adicional exige causa');
    const existente = input.tipo === 'BASE' && await withTenant(userId, (tx) => tx.versionPresupuesto.findFirst({ where: { ordenId, tipo: 'BASE' } }));
    if (existente) throw new ConflictError('La orden ya tiene un presupuesto base');
    const ultima = await withTenant(userId, (tx) => tx.versionPresupuesto.findFirst({ where: { ordenId }, orderBy: { numero: 'desc' } }));
    const vigenciaDias = input.vigenciaDias ?? await this.vigenciaDefault(userId, orden.companyId);
    return withTenant(userId, async (tx) => {
      const creado = await tx.versionPresupuesto.create({ data: {
        companyId: orden.companyId, ordenId, userId, tipo: input.tipo, numero: (ultima?.numero ?? 0) + 1,
        vigenteDesde: utcDate(input.vigenteDesde), vigenciaDias, costoPrevisto: input.costoPrevisto,
        precio: input.precio, plazoDias: input.plazoDias, causaAdicional: input.causaAdicional ?? null,
        renglones: { create: input.renglones.map((r) => ({ ...r, etapaId: r.etapaId ?? null, userId })) },
      }, include: { renglones: true } });
      await recordTraceAudit({ entityType: 'VersionPresupuesto', entityId: creado.id, action: 'create', actor, after: creado }, tx);
      return creado;
    });
  }

  async list(userId: string, ordenId: string) {
    await this.ordenDe(userId, ordenId);
    const presupuestos = await withTenant(userId, (tx) => tx.versionPresupuesto.findMany({ where: { ordenId, userId }, include: { renglones: true }, orderBy: { numero: 'asc' } }));
    const aprobados = presupuestos.filter((p) => p.estado === 'APROBADO' && (p.tipo === 'BASE' || p.tipo === 'ADICIONAL'));
    return {
      presupuestos,
      precioContractual: aprobados.reduce((sum, p) => sum + asNumber(p.precio), 0),
      costoPrevistoTotal: aprobados.reduce((sum, p) => sum + asNumber(p.costoPrevisto), 0),
    };
  }

  async prepare(userId: string, id: string, actor: TraceActor) {
    const actual = await this.presupuestoDe(userId, id);
    if (actual.estado !== 'BORRADOR') throw new InvalidBudgetStateError('Sólo un borrador se puede preparar');
    return this.change(userId, actual, { estado: 'PREPARADO', preparadoPor: actor.id }, 'prepare', actor);
  }

  async approve(userId: string, id: string, actor: TraceActor) {
    const actual = await this.presupuestoDe(userId, id);
    if (actual.estado !== 'PREPARADO') throw new InvalidBudgetStateError('Sólo un presupuesto preparado se puede aprobar');
    if (actual.preparadoPor === actor.id) throw new SameApproverError('Quien prepara no puede aprobar');
    const vence = new Date(actual.vigenteDesde); vence.setUTCDate(vence.getUTCDate() + actual.vigenciaDias);
    if (vence < new Date()) throw new ExpiredBudgetError('El presupuesto venció; revalidalo antes de aprobar');
    return this.change(userId, actual, { estado: 'APROBADO', aprobadoPor: actor.id }, 'approve', actor);
  }

  async reject(userId: string, id: string, actor: TraceActor) {
    const actual = await this.presupuestoDe(userId, id);
    if (actual.estado !== 'PREPARADO') throw new InvalidBudgetStateError('Sólo un presupuesto preparado se puede rechazar');
    return this.change(userId, actual, { estado: 'RECHAZADO' }, 'reject', actor);
  }

  async revalidate(userId: string, id: string, input: PresupuestoRevalidarInput, actor: TraceActor) {
    const actual = await this.presupuestoDe(userId, id);
    if (!['PREPARADO', 'VENCIDO'].includes(actual.estado)) throw new InvalidBudgetStateError('Sólo un presupuesto vencido o preparado se puede revalidar');
    return this.change(userId, actual, { estado: 'BORRADOR', vigenteDesde: utcDate(input.vigenteDesde), vigenciaDias: input.vigenciaDias ?? actual.vigenciaDias, preparadoPor: null, aprobadoPor: null }, 'revalidate', actor);
  }

  private change(userId: string, actual: Awaited<ReturnType<PresupuestoOrdenService['presupuestoDe']>>, data: object, action: string, actor: TraceActor) {
    return withTenant(userId, async (tx) => {
      const actualizado = await tx.versionPresupuesto.update({ where: { id: actual.id }, data, include: { renglones: true } });
      await recordTraceAudit({ entityType: 'VersionPresupuesto', entityId: actual.id, action, actor, before: actual, after: actualizado }, tx);
      return actualizado;
    });
  }
}
