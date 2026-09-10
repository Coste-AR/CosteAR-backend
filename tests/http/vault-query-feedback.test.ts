import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';

const LOG_ID = '00000000-0000-0000-0000-0000000000aa';

const { db } = vi.hoisted(() => ({
  db: {
    vaultQueryLog: { findUnique: vi.fn(), update: vi.fn() },
  },
}));

vi.mock('@/infrastructure/database/prisma.js', () => ({ prisma: db }));

vi.mock('@/infrastructure/http/plugins/authenticate.js', () => ({
  authenticate: async (request: FastifyRequest) => {
    (request as FastifyRequest & { authUser: object }).authUser = { id: 'admin-1', role: 'ADMIN' };
  },
  requireRole: () => async () => {},
}));

// `vault.routes` construye VaultQueryService/GroqService al cargar, y esos leen
// `getEnv()` (que valida el entorno completo, ausente en la suite rápida).
vi.mock('@/infrastructure/config/env.js', () => ({
  getEnv: () => ({ GROQ_API_KEY: 'groq_placeholder', VOYAGE_API_KEY: 'voyage_placeholder' }),
  resetEnvCache: () => {},
}));

async function app() {
  const Fastify = (await import('fastify')).default;
  const { registerVaultRoutes } = await import('@/infrastructure/http/routes/vault.routes.js');
  const { errorHandler } = await import('@/infrastructure/http/error-handler.js');
  const server = Fastify({ logger: false });
  server.setErrorHandler(errorHandler);
  await server.register(registerVaultRoutes);
  await server.ready();
  return server;
}

beforeEach(() => {
  db.vaultQueryLog.findUnique.mockReset();
  db.vaultQueryLog.update.mockReset();
});

describe('POST /vault/query/:id/feedback', () => {
  it('200 y actualiza feedbackUseful cuando la query existe', async () => {
    db.vaultQueryLog.findUnique.mockResolvedValue({ id: LOG_ID });
    db.vaultQueryLog.update.mockResolvedValue({ id: LOG_ID });
    const server = await app();

    const res = await server.inject({
      method: 'POST',
      url: `/vault/query/${LOG_ID}/feedback`,
      payload: { useful: false },
    });

    expect(res.statusCode).toBe(200);
    expect(db.vaultQueryLog.update).toHaveBeenCalledWith({
      where: { id: LOG_ID },
      data: { feedbackUseful: false },
    });
    await server.close();
  });

  it('404 cuando la query no existe (no llama a update)', async () => {
    db.vaultQueryLog.findUnique.mockResolvedValue(null);
    const server = await app();

    const res = await server.inject({
      method: 'POST',
      url: `/vault/query/${LOG_ID}/feedback`,
      payload: { useful: true },
    });

    expect(res.statusCode).toBe(404);
    expect(db.vaultQueryLog.update).not.toHaveBeenCalled();
    await server.close();
  });

  it('400 con body inválido (falta useful)', async () => {
    const server = await app();
    const res = await server.inject({
      method: 'POST',
      url: `/vault/query/${LOG_ID}/feedback`,
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    await server.close();
  });
});
