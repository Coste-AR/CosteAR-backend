import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma, withTenant } from '../../infrastructure/database/prisma.js';
import { NotFoundError, UnprocessableEntityError } from '../../domain/errors/domain-error.js';
import {
  separarTramoSemifijo,
  type SeparacionTramoSemifijo,
} from '../../domain/calculations/tramo-semifijo.js';
import type { SepararTramoSemifijoInput } from '../../shared/schemas/tramo-semifijo.schema.js';
import { recordTraceAudit, type TraceActor } from '../audit/trace-audit.js';

/** Persistencia append-only y vista previa de la separación de un costo semifijo. */
export class TramoSemifijoService {
  constructor(private readonly db: PrismaClient = prisma) {}

  private async companyDe(userId: string, companyId: string) {
    const company = await this.db.company.findFirst({ where: { id: companyId, userId } });
    if (!company) throw new NotFoundError('Empresa no encontrada');
    return company;
  }

  private async conceptoSemifijo(db: PrismaClient | Prisma.TransactionClient, companyId: string, conceptoId: string) {
    const concepto = await db.conceptoCosteo.findFirst({
      where: { id: conceptoId, companyId, deletedAt: null },
    });
    if (!concepto) throw new NotFoundError('Concepto de costeo no encontrado');
    if (concepto.comportamientoVolumen !== 'SEMIFIJO') {
      throw new UnprocessableEntityError(
        `El concepto "${concepto.clave}" tiene que estar clasificado como SEMIFIJO antes de separar sus porciones.`,
        { field: 'comportamientoVolumen' },
      );
    }
    return concepto;
  }

  async previsualizar(
    userId: string,
    companyId: string,
    conceptoId: string,
    input: SepararTramoSemifijoInput,
  ): Promise<SeparacionTramoSemifijo> {
    await this.companyDe(userId, companyId);
    await this.conceptoSemifijo(this.db, companyId, conceptoId);
    return separarTramoSemifijo(input);
  }

  async obtener(userId: string, companyId: string, conceptoId: string) {
    await this.companyDe(userId, companyId);
    await this.conceptoSemifijo(this.db, companyId, conceptoId);
    const tramo = await this.db.tramoSemifijo.findFirst({
      where: { companyId, conceptoId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!tramo) throw new NotFoundError('El concepto todavía no tiene una separación semifija guardada');
    return tramo;
  }

  /**
   * Reemplaza la versión vigente sin borrar historia: la anterior recibe
   * `deletedAt` y la nueva se crea junto con su entrada de bitácora.
   */
  async guardar(
    userId: string,
    companyId: string,
    conceptoId: string,
    input: SepararTramoSemifijoInput,
    actor: TraceActor,
  ) {
    await this.companyDe(userId, companyId);
    const separacion = separarTramoSemifijo(input);

    return withTenant(userId, async (tx) => {
      const concepto = await this.conceptoSemifijo(tx, companyId, conceptoId);
      const anterior = await tx.tramoSemifijo.findFirst({
        where: { companyId, conceptoId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
      });
      const ahora = new Date();
      if (anterior) {
        await tx.tramoSemifijo.update({ where: { id: anterior.id }, data: { deletedAt: ahora } });
      }

      const guardado = await tx.tramoSemifijo.create({
        data: {
          companyId,
          userId,
          conceptoId,
          porcionFija: separacion.porcionFija,
          porcionVariable: separacion.porcionVariable,
          metodo: separacion.metodo,
          observacionesBase: separacion.observacionesBase as unknown as Prisma.InputJsonValue,
          costoVariableUnitario: separacion.costoVariableUnitario,
          coeficienteCorrelacion: separacion.coeficienteCorrelacion,
          creadoPorUserId: actor.id,
        },
      });

      await recordTraceAudit(
        {
          entityType: 'TramoSemifijo',
          entityId: guardado.id,
          action: anterior ? 'update' : 'create',
          actor,
          before: anterior ?? undefined,
          after: guardado,
          comment: `Separación semifija de "${concepto.clave}" guardada con método ${separacion.metodo}; ` +
            `fijo ${separacion.porcionFija} + variable ${separacion.porcionVariable} = ${separacion.importe}.`,
        },
        tx,
      );

      return guardado;
    });
  }
}
