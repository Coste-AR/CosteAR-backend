import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { registerAlertRoutes } from '@/infrastructure/http/routes/alert.routes.js';

const USER = 'user-1';

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    alert: { findMany: vi.fn() },
  },
}));

vi.mock('@/infrastructure/database/prisma.js', () => ({ prisma: mockPrisma }));
vi.mock('@/infrastructure/http/plugins/authenticate.js', () => ({
  authenticate: async (request: FastifyRequest, _reply: FastifyReply) => {
    (request as FastifyRequest & { authUser: object }).authUser = { id: USER };
  },
  auditContext: vi.fn(),
}));

describe('GET /alerts', () => {
  beforeEach(() => vi.clearAllMocks());

  it('publica severidad, indicador visible, unidades y motivo no evaluado en el JSON', async () => {
    mockPrisma.alert.findMany.mockResolvedValue([{
      id: 'alert-1',
      type: 'INDICADOR_FISICO',
      message: 'Falta una lectura para evaluar la regla.',
      severidad: 'ADVERTENCIA',
      indicador: 'postura_plantel',
      indicadorEtiqueta: 'Postura del plantel',
      unidadValor: '%',
      unidadUmbral: '%',
      motivoNoEvaluada: 'Falta una lectura para evaluar la regla.',
    }]);
    const app = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    await app.register(registerAlertRoutes);
    await app.ready();

    const response = await app.inject({ method: 'GET', url: '/alerts' });

    expect(response.statusCode).toBe(200);
    expect(response.json().data[0]).toMatchObject({
      severidad: 'ADVERTENCIA',
      indicador: 'postura_plantel',
      indicadorEtiqueta: 'Postura del plantel',
      unidadValor: '%',
      unidadUmbral: '%',
      motivoNoEvaluada: 'Falta una lectura para evaluar la regla.',
    });
  });
});
