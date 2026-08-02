import type { PrismaClient } from '@prisma/client';
import { prisma, withTenant } from '../../infrastructure/database/prisma.js';
import { recordTraceAudit, type TraceActor } from '../audit/trace-audit.js';
import { NotFoundError, ValidationError } from '../../domain/errors/domain-error.js';
import { CostPeriodPropagationService } from './cost-period-propagation-service.js';

/**
 * DATOS QUE LLEGAN TARDE A UN PERÍODO YA CERRADO.
 *
 * El 5 de agosto llega una factura de julio, y julio ya se cerró. Qué pasa con
 * ella no es una pregunta técnica: es una decisión sobre plata que alguien ya
 * dio por buena. Tres caminos posibles, y el sistema no elige ninguno por su
 * cuenta:
 *
 *   · imputarla al período abierto de hoy (agosto se come el costo de julio);
 *   · reabrir julio, recalcularlo y repropagar la cadena hacia adelante;
 *   · descartarla.
 *
 * Regla dura: MIENTRAS LA DECISIÓN ESTÁ PENDIENTE, EL DATO NO ENTRA A NINGÚN
 * CÁLCULO. Es el mismo criterio que ya rige para un dato sin imputar. Un
 * resultado que avisa que le falta algo es mejor que uno completo que metió
 * plata en el mes equivocado sin que nadie lo autorizara.
 *
 * La política previa de la estructura (`lateDataPolicy`) sí puede resolverla
 * sola: si el costista eligió de antemano, esa elección ES su autorización. Se
 * marca `autoResolved` para que el historial distinga "lo decidió ahora" de "lo
 * dejó decidido antes".
 */

export interface LateDataOutcome {
  /** true si el dato quedó frenado esperando una decisión humana. */
  pendiente: boolean;
  decisionId: string;
  /** Período al que finalmente se imputó, si ya se resolvió. */
  periodoImputado?: string;
  /** En castellano, para mostrarle al costista. */
  mensaje: string;
}

export class LateDataService {
  constructor(
    private readonly db: PrismaClient = prisma,
    private readonly propagation: CostPeriodPropagationService = new CostPeriodPropagationService(db),
  ) {}

  /**
   * ¿El período al que apunta este dato está cerrado? Si no, no hay nada que
   * hacer y la imputación sigue su curso normal.
   */
  async isClosed(structureId: string, periodCode: string): Promise<boolean> {
    const period = await this.db.costPeriod.findFirst({
      where: { structureId, code: periodCode, deletedAt: null },
      select: { status: true },
    });
    return period?.status === 'CLOSED';
  }

  /**
   * Registra el conflicto y aplica la política vigente. Devuelve qué pasó, para
   * que quien imputa sepa si tiene que frenar o puede seguir.
   */
  async handle(
    userId: string,
    dataPointId: string,
    structureId: string,
    targetPeriodCode: string,
    actor: TraceActor,
  ): Promise<LateDataOutcome> {
    const structure = await this.db.costStructure.findFirst({
      where: { id: structureId, userId, deletedAt: null },
      select: { lateDataPolicy: true, productName: true },
    });
    if (!structure) throw new NotFoundError('Estructura de costos no encontrada');

    const abierto = await this.db.costPeriod.findFirst({
      where: { structureId, status: 'OPEN', deletedAt: null },
      select: { code: true, label: true },
    });

    // Si el clasificador reprocesa el mismo documento no se le vuelve a
    // preguntar al costista: cae sobre la decisión que ya existe.
    const existente = await this.db.lateDataDecision.findUnique({
      where: { dataPointId_targetPeriodCode: { dataPointId, targetPeriodCode } },
    });
    if (existente) {
      return {
        pendiente: existente.resolvedAt === null,
        decisionId: existente.id,
        mensaje:
          existente.resolvedAt === null
            ? `Este dato ya está esperando una decisión sobre "${targetPeriodCode}".`
            : `Este dato ya se resolvió para "${targetPeriodCode}".`,
      };
    }

    const decision = await this.db.lateDataDecision.create({
      data: {
        dataPointId,
        structureId,
        userId,
        targetPeriodCode,
        openPeriodCode: abierto?.code ?? null,
        policyAtDetection: structure.lateDataPolicy,
      },
    });

    // Política previa = autorización previa. No se molesta al costista.
    if (structure.lateDataPolicy === 'CURRENT_PERIOD' && abierto) {
      await this.apply(userId, decision.id, 'CURRENT_PERIOD', 'Política de la estructura: imputar al período abierto.', actor, true);
      return {
        pendiente: false,
        decisionId: decision.id,
        periodoImputado: abierto.code,
        mensaje: `El dato correspondía a "${targetPeriodCode}", que está cerrado. Se imputó a "${abierto.label}" según la política de la estructura.`,
      };
    }

    if (structure.lateDataPolicy === 'REOPEN') {
      await this.apply(userId, decision.id, 'REOPEN', 'Política de la estructura: reabrir el período cerrado.', actor, true);
      return {
        pendiente: false,
        decisionId: decision.id,
        periodoImputado: targetPeriodCode,
        mensaje: `Se reabrió "${targetPeriodCode}" según la política de la estructura y se repropagaron los períodos siguientes.`,
      };
    }

    return {
      pendiente: true,
      decisionId: decision.id,
      mensaje:
        `Este dato corresponde a "${targetPeriodCode}", que ya está cerrado. ` +
        'Hasta que decidas qué hacer con él, no entra en ningún cálculo.',
    };
  }

  /** La bandeja: lo que espera una decisión del costista. */
  async listPending(userId: string) {
    const rows = await this.db.lateDataDecision.findMany({
      where: { userId, resolvedAt: null },
      orderBy: { createdAt: 'asc' },
      include: {
        dataPoint: { select: { id: true, label: true, fechaHecho: true } },
        structure: { select: { productName: true } },
      },
      take: 100,
    });

    return rows.map((r) => ({
      id: r.id,
      dato: { id: r.dataPoint.id, nombre: r.dataPoint.label, fecha: r.dataPoint.fechaHecho },
      producto: r.structure.productName,
      periodoCerrado: r.targetPeriodCode,
      periodoAbierto: r.openPeriodCode,
      detectadoEl: r.createdAt.toISOString(),
      opciones: [
        {
          choice: 'CURRENT_PERIOD',
          etiqueta: r.openPeriodCode
            ? `Imputarlo a "${r.openPeriodCode}" (el período abierto)`
            : 'Imputarlo al período abierto',
          consecuencia:
            'El costo entra en el período actual. Los meses cerrados no se tocan, pero el costo aparece en un mes distinto al de la fecha del comprobante.',
          disponible: r.openPeriodCode !== null,
        },
        {
          choice: 'REOPEN',
          etiqueta: `Reabrir "${r.targetPeriodCode}" y recalcularlo`,
          consecuencia:
            'El costo entra en el mes que le corresponde, pero cambian los números de ese mes y de todos los posteriores. Queda registrado quién lo pidió y por qué.',
          disponible: true,
        },
        {
          choice: 'DISCARD',
          etiqueta: 'Descartarlo',
          consecuencia: 'El dato queda anulado y no entra en ningún cálculo. Se puede consultar en trazabilidad.',
          disponible: true,
        },
      ],
    }));
  }

  /** El costista decide. */
  async resolve(
    userId: string,
    decisionId: string,
    choice: 'CURRENT_PERIOD' | 'REOPEN' | 'DISCARD',
    reason: string,
    actor: TraceActor,
  ) {
    const decision = await this.db.lateDataDecision.findFirst({
      where: { id: decisionId, userId },
    });
    if (!decision) throw new NotFoundError('Decisión de dato atrasado no encontrada');
    if (decision.resolvedAt) {
      throw new ValidationError('Esta decisión ya se resolvió. Mirá el historial del dato.');
    }
    return this.apply(userId, decisionId, choice, reason, actor, false);
  }

  /**
   * Ejecuta la decisión. Una sola implementación para el camino automático (la
   * política previa) y el manual (el costista en el momento): así no puede
   * pasar que "reabrir" signifique una cosa cuando lo elige una persona y otra
   * cuando lo elige la política.
   */
  private async apply(
    userId: string,
    decisionId: string,
    choice: 'CURRENT_PERIOD' | 'REOPEN' | 'DISCARD',
    reason: string,
    actor: TraceActor,
    autoResolved: boolean,
  ) {
    const decision = await this.db.lateDataDecision.findFirstOrThrow({ where: { id: decisionId } });

    if (choice === 'REOPEN') {
      const period = await this.db.costPeriod.findFirst({
        where: { structureId: decision.structureId, code: decision.targetPeriodCode, deletedAt: null },
      });
      if (!period) {
        throw new ValidationError(
          `No se encuentra el período "${decision.targetPeriodCode}" para reabrirlo.`,
        );
      }

      await this.db.costPeriod.update({
        where: { id: period.id },
        data: {
          status: 'OPEN',
          reopenedAt: new Date(),
          reopenReason: `Dato atrasado: ${reason}`,
          reopenCount: { increment: 1 },
        },
      });
    }

    // La repropagación va FUERA de la transacción de abajo a propósito: corre el
    // motor sobre cada período de la cadena y puede tardar. Mismo criterio que
    // usa la apertura de un período nuevo.
    const repropagados =
      choice === 'REOPEN'
        ? await this.propagation.repropagateForward(
            userId,
            decision.structureId,
            decision.targetPeriodCode,
          )
        : [];

    return withTenant(userId, async (tx) => {
      const periodoFinal =
        choice === 'REOPEN'
          ? decision.targetPeriodCode
          : choice === 'CURRENT_PERIOD'
            ? decision.openPeriodCode
            : null;

      if (choice === 'DISCARD') {
        await tx.dataPoint.update({
          where: { id: decision.dataPointId },
          data: { voidedAt: new Date(), status: 'anulado' },
        });
      } else if (periodoFinal) {
        await tx.dataPoint.update({
          where: { id: decision.dataPointId },
          data: { periodoImputado: periodoFinal },
        });
      }

      const updated = await tx.lateDataDecision.update({
        where: { id: decisionId },
        data: { choice, reason, resolvedAt: new Date(), resolvedBy: actor.id, autoResolved },
      });

      await recordTraceAudit(
        {
          entityType: 'DataPoint',
          entityId: decision.dataPointId,
          action: 'resolver_dato_atrasado',
          actor,
          before: { periodoObjetivo: decision.targetPeriodCode, estado: 'pendiente' },
          after: {
            choice,
            periodoImputado: periodoFinal,
            autoResolved,
            // Qué meses se movieron por esta decisión. Es lo que el costista va
            // a querer ver cuando pregunte por qué cambió un número de un mes
            // que él ya había dado por bueno.
            periodosRepropagados: repropagados.map((r) => r.periodLabel),
          },
          comment: reason,
        },
        tx,
      );

      return {
        id: updated.id,
        choice,
        periodoImputado: periodoFinal,
        autoResolved,
        periodosRepropagados: repropagados,
      };
    });
  }
}
