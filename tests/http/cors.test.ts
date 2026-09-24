import Fastify from 'fastify';
import cors from '@fastify/cors';
import { describe, expect, it, vi } from 'vitest';
import { createCorsOriginHandler, isAllowed } from '../../src/infrastructure/http/cors-policy.js';

describe('política CORS', () => {
  it('acepta los dominios propios exactos', () => {
    expect(isAllowed('https://coste-ar.com')).toBe(true);
    expect(isAllowed('https://www.coste-ar.com')).toBe(true);
  });

  it('rechaza dominios que sólo contienen el nombre permitido', () => {
    expect(isAllowed('https://coste-ar.com.evil.io')).toBe(false);
    expect(isAllowed('https://evilcoste-ar.com')).toBe(false);
  });

  it('rechaza un preflight sin convertirlo en 500 ni devolver cabecera de permiso', async () => {
    const app = Fastify({ logger: false });
    const warn = vi.fn();
    await app.register(cors, {
      origin: createCorsOriginHandler([], { warn }),
      credentials: true,
      methods: ['POST', 'OPTIONS'],
    });
    app.post('/api/v1/auth/refresh', async () => ({ ok: true }));

    const response = await app.inject({
      method: 'OPTIONS',
      url: '/api/v1/auth/refresh',
      headers: {
        origin: 'https://no-permitido.example',
        'access-control-request-method': 'POST',
      },
    });

    expect(response.statusCode).not.toBe(500);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      { origin: 'https://no-permitido.example', allowedOrigins: [] },
      'CORS: origen rechazado',
    );
    await app.close();
  });
});
