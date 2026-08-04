import type { PrismaClient } from '@prisma/client';
import { prisma, withTenant } from '../../../infrastructure/database/prisma.js';
import { recordTraceAudit, type TraceActor } from '../../audit/trace-audit.js';
import { NotFoundError, UnprocessableEntityError } from '../../../domain/errors/domain-error.js';
import {
  validateSetup,
  setupWarnings,
  type SetupInput,
} from '../../../domain/periods/setup-rules.js';

/**
 * SETUP PREVIO DE COSTEO POR PROCESOS — el "CTO inicial" de la reunión del 30/07.
 *
 * El problema que resuelve, textual del acta: cuando el sistema recibe datos de
 * ingesta (API, audio, imagen, carga manual) no tiene ninguna información sobre
 * la estructura interna de la empresa, y por eso no puede clasificar el costo
 * por departamento. La solución acordada fue pedirle al cliente que declare su
 * mapa productivo ANTES de empezar a costear.
 *
 * Sella `setupCompletedAt`. Mientras no esté sellado, una estructura de
 * PROCESSES no calcula: sin departamentos declarados el resultado no
 * significaría nada.
 *
 * El setup se puede volver a correr para ajustar la configuración, pero NO
 * reescribe departamentos que ya tienen movimiento cargado — eso corrompería
 * cuadros ya calculados. Los agrega al final, que es la única operación que no
 * cambia el significado de lo ya emitido.
 */

export interface CompleteSetupInput extends SetupInput {
  /** Operarios a los que se habilita informar el grado de avance (D7). */
  wipReporterMembershipIds?: string[];
}

export class ProcessSetupService {
  constructor(private readonly db: PrismaClient = prisma) {}

  private async requireProcessStructure(userId: string, structureId: string) {
    const s = await this.db.costStructure.findFirst({
      where: { id: structureId, userId, deletedAt: null },
    });
    if (!s) throw new NotFoundError('Estructura de costos no encontrada');
    if (s.costingSystem !== 'PROCESSES') {
      throw new UnprocessableEntityError(
        'El setup previo es de Costeo por Procesos. Esta estructura es de Costeo por Órdenes.',
        { field: 'costingSystem' },
      );
    }
    return s;
  }

  /**
   * Lo que el wizard necesita para armarse: el estado actual, los departamentos
   * que ya existen y qué operarios pueden marcarse como oficina técnica.
   */
  async getSetup(userId: string, structureId: string) {
    const structure = await this.requireProcessStructure(userId, structureId);

    const [departments, memberships] = await Promise.all([
      this.db.processDepartment.findMany({
        where: { structureId, deletedAt: null },
        orderBy: { sequence: 'asc' },
        select: {
          id: true,
          name: true,
          sequence: true,
          unit: true,
          conversionFromPrevious: true,
        },
      }),
      this.db.operatorMembership.findMany({
        where: { connection: { costistId: userId }, isActive: true },
        select: {
          id: true,
          canReportWipCount: true,
          operator: { select: { name: true, email: true } },
        },
      }),
    ]);

    return {
      completado: structure.setupCompletedAt !== null,
      completadoEl: structure.setupCompletedAt?.toISOString() ?? null,
      hasJointProducts: structure.hasJointProducts,
      wipCountFrequencyDays: structure.wipCountFrequencyDays,
      periodLengthDays: structure.periodLengthDays,
      departments: departments.map((d) => ({
        ...d,
        conversionFromPrevious: d.conversionFromPrevious == null ? null : Number(d.conversionFromPrevious),
      })),
      operarios: memberships.map((m) => ({
        membershipId: m.id,
        nombre: m.operator.name,
        email: m.operator.email,
        informaRecuento: m.canReportWipCount,
      })),
    };
  }

  /**
   * Valida el mapa productivo SIN guardarlo. El wizard lo usa para mostrar
   * problemas y avisos mientras el costista arma la estructura — el "¿qué pasa
   * si hago esto?" tiene que llegar antes de apretar, no después.
   */
  preview(input: CompleteSetupInput) {
    return {
      problemas: validateSetup(input),
      avisos: setupWarnings(input),
    };
  }

  /** Sella el setup. */
  async complete(
    userId: string,
    structureId: string,
    input: CompleteSetupInput,
    actor: TraceActor,
  ) {
    const structure = await this.requireProcessStructure(userId, structureId);

    const problemas = validateSetup(input);
    if (problemas.length > 0) {
      // Un solo 422 con todo lo que falta: mandarlos de a uno obligaría al
      // costista a descubrir los problemas por goteo.
      throw new UnprocessableEntityError(
        `No se puede completar la configuración: ${problemas.map((p) => p.message).join(' ')}`,
        { field: problemas[0]!.field, problemas },
      );
    }

    const existentes = await this.db.processDepartment.findMany({
      where: { structureId, deletedAt: null },
      orderBy: { sequence: 'asc' },
      select: { id: true, name: true, sequence: true, unit: true, conversionFromPrevious: true },
    });
    const porSecuencia = new Map(existentes.map((d) => [d.sequence, d]));

    return withTenant(userId, async (tx) => {
      for (const dep of input.departments) {
        const yaEsta = porSecuencia.get(dep.sequence);
        // H12: factor solo aplica desde el segundo departamento — el primero no
        // recibe de nadie, igual que "recibidas del anterior" en el cuadro.
        const unit = dep.unit?.trim() || null;
        const conversionFromPrevious = dep.sequence > 1 ? (dep.conversionFromPrevious ?? null) : null;

        if (yaEsta) {
          // Renombrar es seguro: la identidad de un departamento es su id, no su
          // nombre, y los cuadros de movimiento cuelgan del id. Unidad y factor
          // se pueden ajustar en cualquier re-corrida del wizard, por la misma
          // razón: no cambian el significado de un cuadro ya cargado, solo cómo
          // se interpreta la comparación entre departamentos hacia adelante.
          if (
            yaEsta.name !== dep.name.trim() ||
            yaEsta.unit !== unit ||
            (yaEsta.conversionFromPrevious == null ? null : Number(yaEsta.conversionFromPrevious)) !==
              conversionFromPrevious
          ) {
            await tx.processDepartment.update({
              where: { id: yaEsta.id },
              data: { name: dep.name.trim(), unit, conversionFromPrevious },
            });
          }
          continue;
        }
        await tx.processDepartment.create({
          data: { structureId, name: dep.name.trim(), sequence: dep.sequence, unit, conversionFromPrevious },
        });
      }

      // Los operarios habilitados a informar el recuento. Se reescribe el
      // conjunto entero (los que no vienen en la lista pierden el permiso), que
      // es lo que espera una pantalla de casillas de verificación.
      const habilitados = input.wipReporterMembershipIds ?? [];
      await tx.operatorMembership.updateMany({
        where: { connection: { costistId: userId } },
        data: { canReportWipCount: false },
      });
      if (habilitados.length > 0) {
        await tx.operatorMembership.updateMany({
          where: { id: { in: habilitados }, connection: { costistId: userId } },
          data: { canReportWipCount: true },
        });
      }

      const updated = await tx.costStructure.update({
        where: { id: structureId },
        data: {
          setupCompletedAt: new Date(),
          hasJointProducts: input.hasJointProducts,
          wipCountFrequencyDays: input.wipCountFrequencyDays ?? null,
        },
      });

      await recordTraceAudit(
        {
          entityType: 'CostStructure',
          entityId: structureId,
          action: 'completar_setup_procesos',
          actor,
          before: { setupCompletadoAntes: structure.setupCompletedAt !== null },
          after: {
            departamentos: input.departments.map((d) => `${d.sequence}. ${d.name}`),
            coproductos: input.hasJointProducts,
            recuentoCadaDias: input.wipCountFrequencyDays ?? null,
            operariosQueInformanRecuento: habilitados.length,
          },
        },
        tx,
      );

      return {
        completado: true,
        completadoEl: updated.setupCompletedAt?.toISOString() ?? null,
        avisos: setupWarnings(input),
      };
    });
  }
}
