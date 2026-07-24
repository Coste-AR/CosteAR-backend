import type { FastifyInstance } from 'fastify';
import { getEnv } from '../../config/env.js';
import { WhatsappWebhookService } from '../../../application/empresa/whatsapp-webhook-service.js';

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

  app.post('/webhooks/whatsapp', async (request, reply) => {
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
}
