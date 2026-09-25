import Fastify, { type FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';

const inviteOperator = vi.hoisted(() => vi.fn());
vi.mock('../../src/application/empresa/empresa-portal-service.js', () => ({
  EmpresaPortalService: class { inviteOperator = inviteOperator; },
}));
vi.mock('../../src/application/empresa/operator-scope-service.js', () => ({
  PERMISOS_OPERADOR: [
    'ordenes.ver', 'ordenes.editar', 'ordenes.ver_margen', 'ordenes.aprobar_presupuesto',
    'ordenes.cerrar', 'inventario.mover', 'horas.cargar', 'horas.aprobar',
  ],
  OperatorScopeService: class {},
}));
vi.mock('../../src/infrastructure/http/plugins/authenticate.js', async (original) => {
  const actual = await original<typeof import('../../src/infrastructure/http/plugins/authenticate.js')>();
  return {
    ...actual,
    authenticate: async (request: FastifyRequest) => {
      request.authUser = { id: '11111111-1111-4111-8111-111111111111', tenantId: 'tenant', role: 'EMPRESA_OPERATOR' };
    },
  };
});

import { registerEmpresaPortalRoutes } from '../../src/infrastructure/http/routes/empresa-portal.routes.js';
import { errorHandler } from '../../src/infrastructure/http/error-handler.js';

describe('CRUD de cargadores — roles', () => {
  it('un EMPRESA_OPERATOR recibe 403 al intentar invitar otro cargador', async () => {
    const app = Fastify();
    app.setErrorHandler(errorHandler);
    await registerEmpresaPortalRoutes(app);
    const response = await app.inject({
      method: 'POST', url: '/empresa-portal/22222222-2222-4222-8222-222222222222/operators',
      payload: { operatorName: 'Otra persona', operatorEmail: 'otra@example.test' },
    });
    expect(response.statusCode).toBe(403);
    expect(inviteOperator).not.toHaveBeenCalled();
  });
});
