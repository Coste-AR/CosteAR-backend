import Fastify, { type FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';
import { requireRole } from '../../src/infrastructure/http/plugins/authenticate.js';
import { errorHandler } from '../../src/infrastructure/http/error-handler.js';

describe('autorización de administración de empresa', () => {
  async function status(role: string) {
    const app = Fastify();
    app.setErrorHandler(errorHandler);
    app.get('/protegido', {
      preHandler: [
        async (request: FastifyRequest) => { request.authUser = { id: 'u1', tenantId: 'u1', role }; },
        requireRole('EMPRESA_ADMIN', 'EMPRESARIO'),
      ],
    }, async () => ({ ok: true }));
    return (await app.inject({ method: 'GET', url: '/protegido' })).statusCode;
  }

  it.each(['EMPRESA_ADMIN', 'EMPRESARIO'])('permite a %s', async (role) => {
    expect(await status(role)).toBe(200);
  });

  it('rechaza a EMPRESA_OPERATOR', async () => {
    expect(await status('EMPRESA_OPERATOR')).toBe(403);
  });
});
