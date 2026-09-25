import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';

const USER = '11111111-1111-1111-1111-111111111111';
const COMPANY = '33333333-3333-3333-3333-333333333333';
const ORDER = '44444444-4444-4444-4444-444444444444';
const { db } = vi.hoisted(() => ({ db: {
  company: { findFirst: vi.fn() },
  ordenTrabajo: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
  traceAuditLog: { create: vi.fn() },
} }));
vi.mock('@/infrastructure/database/prisma.js', () => ({
  prisma: db, withTenant: async (_id: string, fn: (tx: typeof db) => unknown) => fn(db),
}));
vi.mock('@/infrastructure/http/plugins/authenticate.js', () => ({
  authenticate: async (request: FastifyRequest, _reply: FastifyReply) => {
    request.authUser = { id: USER, role: 'EMPRESA_ADMIN', jobTitle: null };
  },
}));

async function app() {
  const Fastify = (await import('fastify')).default;
  const { serializerCompiler, validatorCompiler } = await import('fastify-type-provider-zod');
  const { registerOrdenTrabajoRoutes } = await import('@/infrastructure/http/routes/orden-trabajo.routes.js');
  const { errorHandler } = await import('@/infrastructure/http/error-handler.js');
  const instance = Fastify({ logger: false });
  instance.setErrorHandler(errorHandler);
  instance.setValidatorCompiler(validatorCompiler);
  instance.setSerializerCompiler(serializerCompiler);
  await instance.register(registerOrdenTrabajoRoutes);
  return instance;
}

beforeEach(() => {
  vi.clearAllMocks();
  db.company.findFirst.mockResolvedValue({ id: COMPANY, userId: USER });
  db.ordenTrabajo.findFirst.mockResolvedValue(null);
  db.ordenTrabajo.create.mockResolvedValue({ id: ORDER, companyId: COMPANY, codigo: 'OT-001', descripcion: 'Obra X', cliente: 'Cliente ficticio', estado: 'BORRADOR' });
});

describe('rutas de órdenes de trabajo', () => {
  it('crea con 201 y etiqueta visible', async () => {
    const api = await app();
    const res = await api.inject({ method: 'POST', url: `/companies/${COMPANY}/ordenes-trabajo`, payload: {
      codigo: 'OT-001', descripcion: 'Obra X', cliente: 'Cliente ficticio',
    } });
    expect(res.statusCode).toBe(201);
    expect(res.json().data).toMatchObject({ estado: 'BORRADOR', etiquetaEstado: 'Borrador' });
  });

  it('devuelve 409 para código repetido', async () => {
    db.ordenTrabajo.findFirst.mockResolvedValue({ id: ORDER });
    const api = await app();
    const res = await api.inject({ method: 'POST', url: `/companies/${COMPANY}/ordenes-trabajo`, payload: {
      codigo: 'OT-001', descripcion: 'Otra', cliente: 'Cliente ficticio',
    } });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('CONFLICT');
  });

  it('devuelve 400 tipado para un salto inválido', async () => {
    db.ordenTrabajo.findFirst.mockResolvedValue({ id: ORDER, userId: USER, estado: 'BORRADOR' });
    const api = await app();
    const res = await api.inject({ method: 'POST', url: `/ordenes-trabajo/${ORDER}/transiciones`, payload: { estado: 'EN_PRODUCCION' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('INVALID_STATE_TRANSITION');
  });
});
