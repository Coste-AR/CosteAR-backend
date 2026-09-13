import { beforeEach, describe, expect, it, vi } from 'vitest';

const { db } = vi.hoisted(() => ({
  db: {
    empresaConnection: { findUnique: vi.fn() },
  },
}));

vi.mock('@/infrastructure/database/prisma.js', () => ({ prisma: db }));

const envValues: { WHATSAPP_VERIFY_TOKEN?: string } = {};
vi.mock('@/infrastructure/config/env.js', () => ({
  getEnv: () => envValues,
  resetEnvCache: () => {},
}));

async function app() {
  const Fastify = (await import('fastify')).default;
  const { registerWhatsappRoutes } = await import('@/infrastructure/http/routes/whatsapp.routes.js');
  const { errorHandler } = await import('@/infrastructure/http/error-handler.js');
  const server = Fastify({ logger: false });
  server.setErrorHandler(errorHandler);
  await server.register(registerWhatsappRoutes);
  await server.ready();
  return server;
}

beforeEach(() => {
  delete envValues.WHATSAPP_VERIFY_TOKEN;
});

describe('GET /webhooks/whatsapp — handshake de suscripción', () => {
  it('en rojo: sin WHATSAPP_VERIFY_TOKEN configurado, rechaza con 403 aunque el challenge sea válido', async () => {
    const server = await app();
    const response = await server.inject({
      method: 'GET',
      url: '/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=cualquiera&hub.challenge=echo-123',
    });
    expect(response.statusCode).toBe(403);
  });

  it('en verde: con el token configurado y coincidente, devuelve 200 con el challenge', async () => {
    envValues.WHATSAPP_VERIFY_TOKEN = 'el-token-real';
    const server = await app();
    const response = await server.inject({
      method: 'GET',
      url: '/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=el-token-real&hub.challenge=echo-123',
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('echo-123');
  });

  it('con el token configurado pero uno distinto en la query, rechaza con 403', async () => {
    envValues.WHATSAPP_VERIFY_TOKEN = 'el-token-real';
    const server = await app();
    const response = await server.inject({
      method: 'GET',
      url: '/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=otro&hub.challenge=echo-123',
    });
    expect(response.statusCode).toBe(403);
  });
});
