import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';

const { db, authRole } = vi.hoisted(() => ({
  authRole: { value: 'ADMIN' },
  db: {
    user: { findMany: vi.fn() },
    classifierAiCall: { findMany: vi.fn() },
  },
}));

vi.mock('@/infrastructure/database/prisma.js', () => ({ prisma: db }));
vi.mock('@/infrastructure/database/tenant-context.js', () => ({
  withTenantContext: async (_id: string, fn: () => unknown) => fn(),
}));
vi.mock('@/infrastructure/http/plugins/authenticate.js', () => ({
  authenticate: async (request: FastifyRequest) => {
    (request as FastifyRequest & { authUser: object }).authUser = { id: 'actor', role: authRole.value };
  },
  requireRole: (...roles: string[]) => async (request: FastifyRequest) => {
    if (!roles.includes(request.authUser!.role)) {
      const { ForbiddenError } = await import('@/domain/errors/domain-error.js');
      throw new ForbiddenError('No tenés permisos para esta acción');
    }
  },
}));

async function buildApp() {
  const Fastify = (await import('fastify')).default;
  const { serializerCompiler, validatorCompiler } = await import('fastify-type-provider-zod');
  const { errorHandler } = await import('@/infrastructure/http/error-handler.js');
  const { registerClassifierAiCostRoutes } = await import('@/infrastructure/http/routes/classifier-ai-cost.routes.js');
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(errorHandler);
  await app.register(registerClassifierAiCostRoutes);
  await app.ready();
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  authRole.value = 'ADMIN';
  db.user.findMany.mockResolvedValue([{ id: 'tenant-1' }]);
  db.classifierAiCall.findMany.mockResolvedValue([
    { provider: 'groq', inputTokens: 100, outputTokens: 20, estimatedCost: 0.001, costCurrency: 'USD' },
    { provider: 'groq', inputTokens: null, outputTokens: null, estimatedCost: null, costCurrency: 'USD' },
  ]);
});

describe('GET /admin/classifier/costos', () => {
  it('resume tokens y separa llamadas sin medir de los ceros', async () => {
    const response = await (await buildApp()).inject({
      method: 'GET', url: '/admin/classifier/costos?desde=2026-09-01&hasta=2026-09-30',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.proveedores).toEqual([{
      provider: 'groq', calls: 2, inputTokens: 100, outputTokens: 20,
      estimatedCost: 0.001, costCurrency: 'USD', unmeasuredCalls: 1,
    }]);
  });

  it('403 — rechaza a un usuario que no es ADMIN', async () => {
    authRole.value = 'COSTISTA';
    const response = await (await buildApp()).inject({
      method: 'GET', url: '/admin/classifier/costos?desde=2026-09-01&hasta=2026-09-30',
    });
    expect(response.statusCode).toBe(403);
    expect(db.classifierAiCall.findMany).not.toHaveBeenCalled();
  });
});
