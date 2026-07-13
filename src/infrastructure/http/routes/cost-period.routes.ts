import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { CostPeriodService } from '../../../application/cost-structures/cost-period-service.js';
import { authenticate, auditContext } from '../plugins/authenticate.js';

const idParam = z.object({ id: z.string().uuid() });

const openSchema = z.object({
  /** Arrastrar del período anterior los importes (CIF y sueldos) para revisarlos. */
  carryAmounts: z.boolean().default(false),
});

const closeSchema = z.object({
  /** Cálculo que queda congelado con el período (opcional). */
  runId: z.string().uuid().nullable().default(null),
});

const reopenSchema = z.object({
  reason: z.string().min(10).max(500),
});

/**
 * Períodos de costeo (problema C — Fase 1): abrir, cerrar y reabrir.
 * El período es dueño de los datos y del resultado de su mes.
 */
export async function registerCostPeriodRoutes(app: FastifyInstance): Promise<void> {
  const service = new CostPeriodService();

  // Todos los períodos de una estructura (del más nuevo al más viejo).
  app.get('/structures/:id/periods', { preHandler: authenticate }, async (request) => {
    const { id: structureId } = idParam.parse(request.params);
    const periods = await service.list(request.authUser!.id, structureId);
    return { data: periods };
  });

  // El período en el que se está trabajando.
  app.get('/structures/:id/periods/open', { preHandler: authenticate }, async (request) => {
    const { id: structureId } = idParam.parse(request.params);
    const period = await service.getOpen(request.authUser!.id, structureId);
    return { data: period };
  });

  // Abrir el período siguiente.
  app.post('/structures/:id/periods', { preHandler: authenticate }, async (request, reply) => {
    const { id: structureId } = idParam.parse(request.params);
    const { carryAmounts } = openSchema.parse(request.body ?? {});
    const created = await service.openNext(
      request.authUser!.id,
      structureId,
      { recipe: true, amounts: carryAmounts },
      auditContext(request),
    );
    return reply.status(201).send({ data: created });
  });

  // Cerrar el período (congela los números). Falla si falta el cierre de algún centro.
  app.post('/periods/:id/close', { preHandler: authenticate }, async (request) => {
    const { id } = idParam.parse(request.params);
    const { runId } = closeSchema.parse(request.body ?? {});
    const closed = await service.close(request.authUser!.id, id, runId, auditContext(request));
    return { data: closed };
  });

  // Reabrir un período cerrado. Exige motivo y queda registrado.
  app.post('/periods/:id/reopen', { preHandler: authenticate }, async (request) => {
    const { id } = idParam.parse(request.params);
    const { reason } = reopenSchema.parse(request.body);
    const reopened = await service.reopen(request.authUser!.id, id, reason, auditContext(request));
    return { data: reopened };
  });
}
