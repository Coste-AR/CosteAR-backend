import type { PrismaClient, Prisma } from '@prisma/client';
import { prisma, withTenant } from '../../infrastructure/database/prisma.js';
import { recordTraceAudit, type TraceActor } from '../audit/trace-audit.js';
import { NotFoundError, UnprocessableEntityError } from '../../domain/errors/domain-error.js';
import type {
  ActivoAmortizableCreateInput,
  ActivoAmortizableUpdateInput,
} from '../../shared/schemas/activo-amortizable.schema.js';

/**
 * ACTIVOS AMORTIZABLES — el cable que le faltaba al plantel (issue #116).
 *
 * `src/domain/parametros/activo-amortizable.ts` (la cuota, `amortizaEnPeriodo` y
 * `totalAmortizacionDelPeriodo`) existía con tests en verde y **su único
 * importador era su propio test**. Este servicio es el alta/baja/consulta;
 * `CostPeriodService` es quien resuelve la vida útil contra el catálogo de
 * parámetros de costeo (#115) y suma la cuota al Estado de Costos.
 *
 * Reglas del repo que aplican: los registros se borran LÓGICAMENTE (DOM-01),
 * toda mutación deja su entrada de bitácora en la MISMA transacción (DOM-02),
 * los timestamps son del servidor (DOM-03) y el aislamiento entre empresas lo
 * garantiza RLS vía `withTenant` (DOM-07).
 */
export class ActivoAmortizableService {
  constructor(private readonly db: PrismaClient = prisma) {}

  private async companyDe(userId: string, companyId: string) {
    const company = await this.db.company.findFirst({ where: { id: companyId, userId } });
    if (!company) throw new NotFoundError('Empresa no encontrada');
    return company;
  }

  private async activoDeLaEmpresa(userId: string, id: string) {
    const activo = await this.db.activoAmortizable.findFirst({
      where: { id, userId, deletedAt: null },
    });
    if (!activo) throw new NotFoundError('Activo amortizable no encontrado');
    return activo;
  }

  /** Los activos vigentes de una empresa, del más nuevo al más viejo. */
  async list(userId: string, companyId: string) {
    await this.companyDe(userId, companyId);
    return this.db.activoAmortizable.findMany({
      where: { companyId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(
    userId: string,
    companyId: string,
    input: ActivoAmortizableCreateInput,
    actor: TraceActor,
  ) {
    await this.companyDe(userId, companyId);
    if (input.structureId) {
      const est = await this.db.costStructure.findFirst({
        where: { id: input.structureId, companyId },
      });
      if (!est) throw new NotFoundError('Estructura de costos no encontrada');
    }

    return withTenant(userId, async (tx) => {
      const creado = await tx.activoAmortizable.create({
        data: {
          companyId,
          userId,
          structureId: input.structureId ?? null,
          nombre: input.nombre,
          costoAdquisicion: input.costoAdquisicion,
          valorResidual: input.valorResidual,
          vidaUtilMeses: input.vidaUtilMeses ?? null,
          fechaAlta: input.fechaAlta,
          cantidad: input.cantidad ?? null,
          unidadId: input.unidadId ?? null,
        },
      });

      // DOM-02: la bitácora va en la MISMA transacción. Sin esto, un activo que
      // cambia el costo de meses enteros quedaría dado de alta sin rastro de
      // quién lo cargó.
      await recordTraceAudit(
        {
          entityType: 'ActivoAmortizable',
          entityId: creado.id,
          action: 'create',
          actor,
          after: creado,
          comment: `Activo amortizable dado de alta: ${input.nombre}`,
        },
        tx,
      );

      return creado;
    });
  }

  async update(userId: string, id: string, input: ActivoAmortizableUpdateInput, actor: TraceActor) {
    const actual = await this.activoDeLaEmpresa(userId, id);

    const costoFinal = input.costoAdquisicion ?? Number(actual.costoAdquisicion);
    const residualFinal = input.valorResidual ?? Number(actual.valorResidual);
    if (residualFinal > costoFinal) {
      throw new UnprocessableEntityError(
        'El valor residual no puede superar al costo de adquisición: ' +
          'daría una amortización negativa.',
        { field: 'valorResidual' },
      );
    }

    return withTenant(userId, async (tx) => {
      const data: Prisma.ActivoAmortizableUncheckedUpdateInput = {
        ...(input.nombre !== undefined && { nombre: input.nombre }),
        ...(input.costoAdquisicion !== undefined && { costoAdquisicion: input.costoAdquisicion }),
        ...(input.valorResidual !== undefined && { valorResidual: input.valorResidual }),
        ...(input.vidaUtilMeses !== undefined && { vidaUtilMeses: input.vidaUtilMeses }),
        ...(input.fechaAlta !== undefined && { fechaAlta: input.fechaAlta }),
        ...(input.cantidad !== undefined && { cantidad: input.cantidad }),
        ...(input.unidadId !== undefined && { unidadId: input.unidadId }),
      };
      const actualizado = await tx.activoAmortizable.update({ where: { id }, data });

      await recordTraceAudit(
        {
          entityType: 'ActivoAmortizable',
          entityId: id,
          action: 'update',
          actor,
          before: actual,
          after: actualizado,
          comment: `Activo amortizable modificado: ${actualizado.nombre}`,
        },
        tx,
      );

      return actualizado;
    });
  }

  /**
   * Borrado LÓGICO (DOM-01). Un activo dado de baja deja de aportar cuota a
   * los períodos siguientes, pero los que ya se calcularon con su cuota no
   * cambian: DOM-01 prohíbe pisar un costo ya cerrado.
   */
  async remove(userId: string, id: string, actor: TraceActor) {
    const actual = await this.activoDeLaEmpresa(userId, id);

    return withTenant(userId, async (tx) => {
      const borrado = await tx.activoAmortizable.update({
        where: { id },
        data: { deletedAt: new Date() },
      });

      await recordTraceAudit(
        {
          entityType: 'ActivoAmortizable',
          entityId: id,
          action: 'delete',
          actor,
          before: actual,
          comment: `Activo amortizable dado de baja: ${actual.nombre}`,
        },
        tx,
      );

      return borrado;
    });
  }
}
