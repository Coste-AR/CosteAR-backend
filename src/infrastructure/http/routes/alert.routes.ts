import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AlertService } from '../../../application/alerts/alert-service.js';
import { authenticate, auditContext } from '../plugins/authenticate.js';

const idParam = z.object({ id: z.string().uuid() });
const listQuery = z.object({ unread: z.coerce.boolean().optional() });
const settingsSchema = z.object({
  marginThresholdPct: z.number().finite().min(0).max(100).optional(),
  emailNotifications: z.boolean().optional(),
});

export async function registerAlertRoutes(app: FastifyInstance): Promise<void> {
  const service = new AlertService();

  app.get('/alerts', { preHandler: authenticate }, async (request) => {
    const { unread } = listQuery.parse(request.query);
    const data = await service.list(request.authUser!.id, unread ?? false);
    return { data };
  });

  app.put('/alerts/:id/read', { preHandler: authenticate }, async (request) => {
    const { id } = idParam.parse(request.params);
    const data = await service.markRead(request.authUser!.id, id);
    return { data };
  });

  app.get('/alerts/settings', { preHandler: authenticate }, async (request) => {
    const data = await service.getSettings(request.authUser!.id);
    return { data };
  });

  app.put('/alerts/settings', { preHandler: authenticate }, async (request) => {
    const input = settingsSchema.parse(request.body);
    const data = await service.updateSettings(request.authUser!.id, input, auditContext(request));
    return { data };
  });
}
