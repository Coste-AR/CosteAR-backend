import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AdvisorService } from '../../../application/advisor/advisor-service.js';
import { authenticate } from '../plugins/authenticate.js';

const advisorSchema = z.object({
  kind: z.enum(['cost_result', 'reconciliation', 'macro', 'alerts']),
  context: z.record(z.unknown()),
});

export async function registerAdvisorRoutes(app: FastifyInstance): Promise<void> {
  const svc = new AdvisorService();

  // Consejero de IA contextual. Recibe datos reales ya calculados y devuelve
  // una lectura + recomendaciones. Rate limit para no abusar de la API.
  app.post('/advisor', {
    preHandler: authenticate,
    config: { rateLimit: { max: 30, timeWindow: '5 minutes' } },
  }, async (request, reply) => {
    const { kind, context } = advisorSchema.parse(request.body);
    const result = await svc.advise(kind, context);
    if (!result) {
      return reply.status(503).send({ error: { message: 'El consejero no está disponible ahora.' } });
    }
    return reply.send({ data: result });
  });
}
