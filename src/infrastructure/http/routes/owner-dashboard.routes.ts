import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { OwnerDashboardService } from '../../../application/cost-structures/owner-dashboard-service.js';
import { authenticate } from '../plugins/authenticate.js';

const periodParams = z.object({ id: z.string().uuid() });

export async function registerOwnerDashboardRoutes(app: FastifyInstance): Promise<void> {
  const service = new OwnerDashboardService();
  app.get('/periods/:id/tablero-dueno', { preHandler: authenticate }, async (request) => {
    const { id } = periodParams.parse(request.params);
    return { data: await service.get(request.authUser!.id, id) };
  });
}
