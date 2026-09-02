import type { FastifyInstance } from 'fastify';
import { TelegramWebhookService, type TelegramMessage } from '../../../application/empresa/telegram-webhook-service.js';
import { getEnv } from '../../config/env.js';

interface TelegramUpdate {
  message?: TelegramMessage;
}

export async function registerTelegramRoutes(app: FastifyInstance): Promise<void> {
  app.post('/webhooks/telegram', async (request, reply) => {
    const token = getEnv().TELEGRAM_BOT_TOKEN;
    if (!token) return reply.status(503).send('not configured');

    const message = (request.body as TelegramUpdate).message;
    if (!message?.chat?.id) return reply.status(200).send({ ok: true });

    await new TelegramWebhookService(token).handleMessage(message);
    return reply.status(200).send({ ok: true });
  });
}
