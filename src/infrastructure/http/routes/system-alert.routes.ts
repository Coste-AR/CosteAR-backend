import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { SystemAlertService } from '../../../application/system/system-alert-service.js';
import { authenticate, requireRole } from '../plugins/authenticate.js';
import { getEnv } from '../../config/env.js';

interface WebhookRequest extends FastifyRequest {
  rawBody?: Buffer;
}

/** Sólo se acepta como link clickeable un http(s) real — nunca javascript:, data:, etc. */
export function sanitizeUrl(url: unknown): string | undefined {
  if (typeof url !== 'string') return undefined;
  return /^https?:\/\//i.test(url) ? url : undefined;
}

export function verifySentrySignature(request: WebhookRequest, secret: string): boolean {
  const header = request.headers['sentry-hook-signature'];
  if (typeof header !== 'string' || !header || !request.rawBody) return false;

  const expected = createHmac('sha256', secret).update(request.rawBody).digest('hex');
  const expectedBuf = Buffer.from(expected, 'hex');
  const providedBuf = Buffer.from(header, 'hex');
  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}

export async function registerSystemAlertRoutes(fastify: FastifyInstance) {
  const alertService = new SystemAlertService();

  // Contexto encapsulado: el content-type parser de buffer crudo (necesario para
  // verificar la firma HMAC) queda scopeado SOLO a este webhook, no afecta el
  // parseo JSON del resto de la API.
  await fastify.register(async (webhook) => {
    webhook.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
      (req as WebhookRequest).rawBody = body as Buffer;
      try {
        done(null, (body as Buffer).length ? JSON.parse((body as Buffer).toString('utf8')) : {});
      } catch (err) {
        done(err as Error, undefined);
      }
    });

    webhook.post('/webhooks/sentry', async (request, reply) => {
      const env = getEnv();
      if (!env.SENTRY_WEBHOOK_SECRET) {
        request.log.error('[webhooks/sentry] SENTRY_WEBHOOK_SECRET no configurado — rechazando (fail closed)');
        return reply.status(503).send({ error: 'webhook not configured' });
      }
      if (!verifySentrySignature(request as WebhookRequest, env.SENTRY_WEBHOOK_SECRET)) {
        request.log.warn('[webhooks/sentry] Firma inválida o ausente');
        return reply.status(401).send({ error: 'invalid signature' });
      }

      const body = request.body as any;
      const action = body?.action;
      const data = body?.data;

      // Sentry sends 'created' for new issues
      if (action === 'created' && data?.issue) {
        await alertService.create({
          source: 'sentry',
          level: String(data.issue.level || 'error'),
          message: String(data.issue.title || 'Unknown Sentry Error'),
          sentryIssueId: data.issue.id ? String(data.issue.id) : undefined,
          sentryUrl: sanitizeUrl(data.issue.web_url),
        });
      } else if (body?.level && body?.message) {
        // Fallback for simple webhook testing or different event types
        await alertService.create({
          source: 'sentry',
          level: String(body.level),
          message: String(body.message),
          sentryIssueId: body.id ? String(body.id) : undefined,
          sentryUrl: sanitizeUrl(body.url),
        });
      }

      return reply.status(200).send({ success: true });
    });
  });

  // Handle GET for Sentry just in case it verifies the endpoint (no body, nada que firmar)
  fastify.get('/webhooks/sentry', async (_request, reply) => {
    return reply.status(200).send({ success: true });
  });

  // Admin endpoint to list alerts
  fastify.get(
    '/system-alerts',
    {
      preHandler: [authenticate, requireRole('ADMIN')],
    },
    async (request, reply) => {
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
