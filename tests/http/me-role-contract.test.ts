import Fastify, { type FastifyRequest } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authState = vi.hoisted(() => ({ authenticated: true, role: 'EMPRESA_ADMIN' }));
const USER_ID = '11111111-1111-4111-8111-111111111111';
const COMPANY_ID = '22222222-2222-4222-8222-222222222222';
const userFindUnique = vi.hoisted(() => vi.fn());
const companyFindFirst = vi.hoisted(() => vi.fn());
const membershipFindFirst = vi.hoisted(() => vi.fn());
const packageFindFirst = vi.hoisted(() => vi.fn());

vi.mock('../../src/infrastructure/http/plugins/authenticate.js', () => ({
  authenticate: async (request: FastifyRequest) => {
    if (!authState.authenticated) {
      const { UnauthorizedError } = await import('../../src/domain/errors/domain-error.js');
      throw new UnauthorizedError('Token de acceso requerido');
    }
    request.authUser = {
      id: '11111111-1111-4111-8111-111111111111',
      tenantId: '11111111-1111-4111-8111-111111111111',
      role: authState.role,
    };
  },
  auditContext: () => ({ ipAddress: '127.0.0.1', userAgent: 'vitest' }),
}));

vi.mock('../../src/infrastructure/database/prisma.js', () => ({
  prisma: {
    user: { findUnique: userFindUnique },
    company: { findFirst: companyFindFirst, findMany: vi.fn() },
    operatorMembership: { findFirst: membershipFindFirst },
    paqueteRubro: { findFirst: packageFindFirst },
  },
}));

vi.mock('../../src/application/legal/terms-service.js', () => ({
  TermsService: class { needsAcceptance = vi.fn().mockResolvedValue({ needs: false }); },
}));

vi.mock('../../src/infrastructure/cloudinary/cloudinary-upload.js', () => ({ uploadToCloudinary: vi.fn() }));
vi.mock('../../src/application/audit/audit-logger.js', () => ({ recordAudit: vi.fn() }));

import { registerUserRoutes } from '../../src/infrastructure/http/routes/user.routes.js';
import { errorHandler } from '../../src/infrastructure/http/error-handler.js';

describe('GET /me — identidad y rol vigente', () => {
  beforeEach(() => {
    authState.authenticated = true;
    authState.role = 'EMPRESA_ADMIN';
    userFindUnique.mockReset().mockResolvedValue({
      id: USER_ID, email: 'persona@example.test', role: 'EMPRESA_ADMIN',
    });
    companyFindFirst.mockReset().mockResolvedValue({ id: COMPANY_ID });
    membershipFindFirst.mockReset();
    packageFindFirst.mockReset();
  });

  async function app() {
    const instance = Fastify();
    instance.setErrorHandler(errorHandler);
    await registerUserRoutes(instance);
    return instance;
  }

  it('devuelve id, email, rol y empresaId para la sesión', async () => {
    const instance = await app();
    const response = await instance.inject({ method: 'GET', url: '/me' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: {
        id: USER_ID, email: 'persona@example.test', rol: 'EMPRESA_ADMIN', empresaId: COMPANY_ID,
        entidadesAutorizadas: { unidadesProductivas: [], depositos: [] },
      },
    });
  });

  it('devuelve 401 sin sesión', async () => {
    authState.authenticated = false;
    const instance = await app();
    const response = await instance.inject({ method: 'GET', url: '/me' });
    expect(response.statusCode).toBe(401);
  });

  it('devuelve sólo las entidades autorizadas con las etiquetas del paquete', async () => {
    authState.role = 'EMPRESA_OPERATOR';
    userFindUnique.mockResolvedValue({ id: USER_ID, email: 'cargador@example.test', role: 'EMPRESA_OPERATOR' });
    membershipFindFirst.mockResolvedValue({
      connection: { companyId: COMPANY_ID, company: { industry: 'avicola' } },
      unidadesAutorizadas: [{ unidadProductiva: { id: '33333333-3333-4333-8333-333333333333', referencia: 'G-1' } }],
      depositosAutorizados: [{ deposito: { id: '44444444-4444-4444-8444-444444444444', referencia: 'S-1' } }],
    });
    packageFindFirst.mockResolvedValue({ lexicon: { UnidadProductiva: 'Galpón', Deposito: 'Silo' } });
    const response = await (await app()).inject({ method: 'GET', url: '/me' });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.entidadesAutorizadas).toEqual({
      unidadesProductivas: [{ id: '33333333-3333-4333-8333-333333333333', referencia: 'G-1', etiqueta: 'Galpón' }],
      depositos: [{ id: '44444444-4444-4444-8444-444444444444', referencia: 'S-1', etiqueta: 'Silo' }],
    });
  });
});
