import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { getEnv } from '../../config/env.js';
import { WhatsappWebhookService } from '../../../application/empresa/whatsapp-webhook-service.js';

interface WebhookRequest extends FastifyRequest {
  rawBody?: Buffer;
}

/** Verifica X-Hub-Signature-256 (formato "sha256=<hex>") contra el App Secret de Meta. */
export function verifyMetaSignature(request: WebhookRequest, appSecret: string): boolean {
  const header = request.headers['x-hub-signature-256'];
  if (typeof header !== 'string' || !header.startsWith('sha256=') || !request.rawBody) return false;

  const provided = header.slice('sha256='.length);
  const expected = createHmac('sha256', appSecret).update(request.rawBody).digest('hex');
  const expectedBuf = Buffer.from(expected, 'hex');
  const providedBuf = Buffer.from(provided, 'hex');
  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}

export async function registerWhatsappRoutes(app: FastifyInstance): Promise<void> {
  const svc = new WhatsappWebhookService();

  app.get('/webhooks/whatsapp', async (request, reply) => {
    const query = request.query as Record<string, string>;
    const mode = query['hub.mode'];
    const token = query['hub.verify_token'];
    const challenge = query['hub.challenge'];
    const env = getEnv();

    if (mode === 'subscribe' && token === env.WHATSAPP_VERIFY_TOKEN) {
      return reply.status(200).send(challenge);
    }
    return reply.status(403).send('Forbidden');
  });

  // Contexto encapsulado: el content-type parser de buffer crudo (necesario
  // para verificar la firma HMAC) queda scopeado solo a este webhook.
  await app.register(async (webhook) => {
    webhook.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
      (req as WebhookRequest).rawBody = body as Buffer;
      try {
        done(null, (body as Buffer).length ? JSON.parse((body as Buffer).toString('utf8')) : {});
      } catch (err) {
        done(err as Error, undefined);
      }
    });

    webhook.post('/webhooks/whatsapp', async (request, reply) => {
      const env = getEnv();
      if (!env.WHATSAPP_APP_SECRET) {
        request.log.error('[webhooks/whatsapp] WHATSAPP_APP_SECRET no configurado — rechazando (fail closed)');
        return reply.status(503).send('not configured');
      }
      if (!verifyMetaSignature(request as WebhookRequest, env.WHATSAPP_APP_SECRET)) {
        request.log.warn('[webhooks/whatsapp] Firma inválida o ausente');
        return reply.status(401).send('invalid signature');
      }

      const body = request.body as any;

      if (body.object) {
        if (body.entry && body.entry[0].changes && body.entry[0].changes[0] && body.entry[0].changes[0].value.messages && body.entry[0].changes[0].value.messages[0]) {
          const from = body.entry[0].changes[0].value.messages[0].from;
          const msg = body.entry[0].changes[0].value.messages[0];

          // Respondemos 200 rápido a Meta
          reply.status(200).send('EVENT_RECEIVED');

          // Procesamos asíncronamente
          await svc.handleMessage(from, msg).catch((err) => {
            console.error('[WhatsApp] Error handling message:', err);
          });
          return;
        }
        return reply.status(200).send('EVENT_RECEIVED');
      }
      return reply.status(404).send('Not Found');
    });
  });
}
