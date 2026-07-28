import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { SystemAlertService } from '../../../application/system/system-alert-service.js';
import { authenticate, requireRole } from '../plugins/authenticate.js';

export async function registerSystemAlertRoutes(fastify: FastifyInstance) {
  const alertService = new SystemAlertService();

  // Sentry Webhook endpoint (public but relies on some security mechanism or secret URL)
  // For simplicity, we just use a secret token from headers if needed, but here we just
  // parse the body provided by Sentry.
  fastify.post('/webhooks/sentry', async (request, reply) => {
    // Ideally validate Sentry-Hook-Signature or a token here
    // const token = request.headers['x-sentry-token'];
    
    // Sentry webhook payload varies, we do a loose typing
    const body = request.body as any;
    const action = body?.action;
    const data = body?.data;

    // Sentry sends 'created' for new issues
    if (action === 'created' && data?.issue) {
      await alertService.create({
        source: 'sentry',
        level: data.issue.level || 'error',
        message: data.issue.title || 'Unknown Sentry Error',
        sentryIssueId: data.issue.id,
        sentryUrl: data.issue.web_url,
      });
    } else if (body?.level && body?.message) {
      // Fallback for simple webhook testing or different event types
      await alertService.create({
        source: 'sentry',
        level: body.level,
        message: body.message,
        sentryIssueId: body.id?.toString(),
        sentryUrl: body.url,
      });
    }

    return reply.status(200).send({ success: true });
  });

  // Admin endpoint to list alerts
  fastify.get(
    '/system-alerts',
    {
      preHandler: [authenticate, requireRole('ADMIN')],
    },
    async (request, reply) => {
      // In a real app we'd verify request.user is admin
      const query = request.query as { unresolvedOnly?: string };
      const unresolvedOnly = query.unresolvedOnly === 'true';
      const alerts = await alertService.list(unresolvedOnly);
      return reply.send(alerts);
    }
  );

  // Admin endpoint to resolve an alert
  fastify.post(
    '/system-alerts/:id/resolve',
    {
      preHandler: [authenticate, requireRole('ADMIN')],
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const alert = await alertService.resolve(id);
      return reply.send(alert);
    }
  );
}
