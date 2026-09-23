import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma, withTenant } from '../../infrastructure/database/prisma.js';
import { NotFoundError, UnprocessableEntityError } from '../../domain/errors/domain-error.js';
import { calcularEquilibrioSectorial, type CoproductoSectorial } from '../../domain/calculations/equilibrio-sectorial.js';
import { recordTraceAudit, type TraceActor } from '../audit/trace-audit.js';
import type { ActualizarSegmentoAnalisisInput, CrearSegmentoAnalisisInput } from '../../shared/schemas/segmento-analisis.schema.js';

export class SegmentoAnalisisService {
  constructor(private readonly db: PrismaClient = prisma) {}

  private async companyDe(userId: string, companyId: string) {
    const company = await this.db.company.findFirst({ where: { id: companyId, userId } });
    if (!company) throw new NotFoundError('Negocio no encontrado');
  }

  private salida(segmento: {
    id: string; parentId: string | null; nombre: string; nivel: string; produccionConjunta: boolean;
    precioUnitario: Prisma.Decimal | null; costoVariableUnitario: Prisma.Decimal | null;
    participacion: Prisma.Decimal; costoFijoDirecto: Prisma.Decimal; prorrateoIndirectos: Prisma.Decimal;
    coproductos: Prisma.JsonValue;
  }) {
    return {
      id: segmento.id, parentId: segmento.parentId, nombre: segmento.nombre,
      nivel: segmento.nivel as 'empresa' | 'division' | 'canal' | 'linea',
      produccionConjunta: segmento.produccionConjunta,
      precioUnitario: segmento.precioUnitario === null ? null : Number(segmento.precioUnitario),
      costoVariableUnitario: segmento.costoVariableUnitario === null ? null : Number(segmento.costoVariableUnitario),
      participacion: Number(segmento.participacion), costoFijoDirecto: Number(segmento.costoFijoDirecto),
      prorrateoIndirectos: Number(segmento.prorrateoIndirectos),
      coproductos: segmento.coproductos as unknown as CoproductoSectorial[],
    };
  }

  async listar(userId: string, companyId: string) {
    await this.companyDe(userId, companyId);
    const filas = await this.db.segmentoAnalisis.findMany({ where: { companyId, deletedAt: null }, orderBy: [{ nivel: 'asc' }, { nombre: 'asc' }] });
    return filas.map((fila) => this.salida(fila));
  }

  private async validarParent(companyId: string, parentId?: string | null, id?: string) {
    if (!parentId) return;
    if (parentId === id) throw new UnprocessableEntityError('Un segmento no puede ser su propio padre.', { field: 'parentId' });
    const parent = await this.db.segmentoAnalisis.findFirst({ where: { id: parentId, companyId, deletedAt: null } });
    if (!parent) throw new NotFoundError('Segmento padre no encontrado');
  }

  async crear(userId: string, companyId: string, input: CrearSegmentoAnalisisInput, actor: TraceActor) {
    await this.companyDe(userId, companyId);
    if (input.produccionConjunta && input.costoVariableUnitario != null) {
      throw new UnprocessableEntityError('R15: una producción conjunta no acepta costo variable propio; los coproductos entran como ingresos ponderados por rendimiento.', { field: 'costoVariableUnitario' });
    }
    if (input.produccionConjunta && input.coproductos.length === 0) {
      throw new UnprocessableEntityError('R15: declare al menos un coproducto con precio y rendimiento.', { field: 'coproductos' });
    }
    await this.validarParent(companyId, input.parentId);
    return withTenant(userId, async (tx) => {
      const creado = await tx.segmentoAnalisis.create({ data: {
        companyId, userId, parentId: input.parentId ?? null, nombre: input.nombre, nivel: input.nivel,
        produccionConjunta: input.produccionConjunta, precioUnitario: input.precioUnitario ?? null,
        costoVariableUnitario: input.costoVariableUnitario ?? null, participacion: input.participacion,
        costoFijoDirecto: input.costoFijoDirecto, prorrateoIndirectos: input.prorrateoIndirectos,
        coproductos: input.coproductos,
      } });
      await recordTraceAudit({ entityType: 'SegmentoAnalisis', entityId: creado.id, action: 'create', actor, after: creado, comment: `Segmento "${creado.nombre}" creado.` }, tx);
      return this.salida(creado);
    });
  }

  async actualizar(userId: string, companyId: string, id: string, input: ActualizarSegmentoAnalisisInput, actor: TraceActor) {
    await this.companyDe(userId, companyId);
    const existente = await this.db.segmentoAnalisis.findFirst({ where: { id, companyId, deletedAt: null } });
    if (!existente) throw new NotFoundError('Segmento no encontrado');
    await this.validarParent(companyId, input.parentId, id);
    const conjunta = input.produccionConjunta ?? existente.produccionConjunta;
    const costoVariable = input.costoVariableUnitario === undefined ? existente.costoVariableUnitario : input.costoVariableUnitario;
    if (conjunta && costoVariable !== null) throw new UnprocessableEntityError('R15: una producción conjunta no acepta costo variable propio.', { field: 'costoVariableUnitario' });
    return withTenant(userId, async (tx) => {
      const actualizado = await tx.segmentoAnalisis.update({ where: { id }, data: {
        ...input,
        coproductos: input.coproductos as Prisma.InputJsonValue | undefined,
      } });
      await recordTraceAudit({ entityType: 'SegmentoAnalisis', entityId: id, action: 'update', actor, before: existente, after: actualizado, comment: `Segmento "${actualizado.nombre}" actualizado.` }, tx);
      return this.salida(actualizado);
    });
  }

  async eliminar(userId: string, companyId: string, id: string, actor: TraceActor) {
    await this.companyDe(userId, companyId);
    return withTenant(userId, async (tx) => {
      const existente = await tx.segmentoAnalisis.findFirst({ where: { id, companyId, deletedAt: null } });
      if (!existente) throw new NotFoundError('Segmento no encontrado');
      const hijos = await tx.segmentoAnalisis.count({ where: { parentId: id, deletedAt: null } });
      if (hijos > 0) throw new UnprocessableEntityError('El segmento tiene hijos activos; reasignalos antes de eliminarlo.');
      const eliminado = await tx.segmentoAnalisis.update({ where: { id }, data: { deletedAt: new Date() } });
      await recordTraceAudit({ entityType: 'SegmentoAnalisis', entityId: id, action: 'delete', actor, before: existente, after: eliminado }, tx);
    });
  }

  async calcular(userId: string, companyId: string) {
    const segmentos = await this.listar(userId, companyId);
    return calcularEquilibrioSectorial(segmentos);
  }
}
