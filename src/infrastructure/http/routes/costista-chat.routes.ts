import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { CostitaChatService } from '../../../application/costista-chat/costista-chat-service.js';
import { authenticate } from '../plugins/authenticate.js';

const interpretSchema = z.object({
  message: z.string().min(1).max(2000),
  conversationHistory: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().max(2000),
      }),
    )
    .max(20)
    .optional(),
});

const confirmSchema = z.object({
  actionType: z.enum(['CREATE_ENTRY', 'CREATE_ALERT']),
  proposedEntry: z
    .object({
      companyId: z.string(),
      companyName: z.string(),
      rawContent: z.string().min(1).max(5000),
      costSection: z.enum([
        'MATERIA_PRIMA', 'MANO_DE_OBRA', 'COSTOS_INDIRECTOS', 'VENTAS',
        'GASTO_COMERCIALIZACION', 'GASTO_ADMINISTRACION', 'GASTO_FINANCIERO', 'DESCONOCIDO',
      ]),
      documentType: z.string(),
      estimatedImpact: z.string().optional(),
    })
    .optional(),
  proposedAlert: z
    .object({
      companyId: z.string(),
      companyName: z.string(),
      message: z.string().min(1).max(500),
      severity: z.enum(['LOW', 'MEDIUM', 'HIGH']),
    })
    .optional(),
});

export async function registerCostitaChatRoutes(app: FastifyInstance): Promise<void> {
  const svc = new CostitaChatService();

  /**
   * POST /costista-chat/interpret
   * El costista manda un mensaje → la IA lo interpreta y propone una acción.
   * NO modifica nada en la DB.
   */
  app.post('/costista-chat/interpret', { preHandler: authenticate }, async (request, reply) => {
    const input = interpretSchema.parse(request.body);
    const result = await svc.interpret(request.authUser!.id, input);
    return reply.send({ data: result });
  });

  /**
   * POST /costista-chat/confirm
   * El costista confirma la acción propuesta → se aplica en la DB.
   */
  app.post('/costista-chat/confirm', { preHandler: authenticate }, async (request, reply) => {
    const input = confirmSchema.parse(request.body);
    const result = await svc.confirm(request.authUser!.id, input);
    return reply.status(201).send({ data: result });
  });

  /**
   * POST /costista-chat/feedback
   * El costista reporta explícitamente un error o sugerencia.
   */
  app.post('/costista-chat/feedback', { preHandler: authenticate }, async (request, reply) => {
    const feedbackSchema = z.object({
      message: z.string().min(1),
      type: z.enum(['ASSISTANT_MISS', 'IMPROVEMENT_REPORT']),
      details: z.string().optional()
    });
    const input = feedbackSchema.parse(request.body);
    await svc.submitFeedback(request.authUser!.id, input);
    return reply.status(201).send({ success: true });
  });
}
