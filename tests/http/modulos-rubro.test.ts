import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { PAQUETE_AVICOLA_POSTURA } from '@/application/operacion/paquete-avicola.js';

const USER = 'user-1';
const COMPANY_ID = '00000000-0000-0000-0000-000000000001';

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    company: { findFirst: vi.fn() },
    paqueteRubro: { findMany: vi.fn() },
    configuracionModuloRubro: { findMany: vi.fn(), findUnique: vi.fn(), upsert: vi.fn() },
  },
}));

vi.mock('@/infrastructure/database/prisma.js', () => ({
  prisma: mockPrisma,
  withTenant: async (_userId: string, fn: (tx: typeof mockPrisma) => unknown) => fn(mockPrisma),
}));
vi.mock('@/application/audit/trace-audit.js', () => ({ recordTraceAudit: vi.fn(async () => undefined) }));
vi.mock('@/infrastructure/http/plugins/authenticate.js', () => ({
  authenticate: async (request: FastifyRequest, _reply: FastifyReply) => {
    (request as FastifyRequest & { authUser: object }).authUser = { id: USER, role: 'COSTISTA', jobTitle: null };
  },
}));

async function buildApp() {
  const Fastify = (await import('fastify')).default;
  const { registerModulosRubroRoutes } = await import('@/infrastructure/http/routes/modulos-rubro.routes.js');
  const { errorHandler } = await import('@/infrastructure/http/error-handler.js');
  const app = Fastify({ logger: false });
  app.setErrorHandler(errorHandler);
  await app.register(registerModulosRubroRoutes);
  await app.ready();
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.company.findFirst.mockResolvedValue({ id: COMPANY_ID, userId: USER, industry: 'AVICULTURA' });
  mockPrisma.paqueteRubro.findMany.mockResolvedValue([{ category: 'AVICOLA_POSTURA', userId: null, companyId: null, structureId: null, periodId: null, ...PAQUETE_AVICOLA_POSTURA, scale: null }]);
  mockPrisma.configuracionModuloRubro.findMany.mockResolvedValue([]);
  mockPrisma.configuracionModuloRubro.findUnique.mockResolvedValue(null);
  mockPrisma.configuracionModuloRubro.upsert.mockImplementation(async ({ create }: { create: Record<string, unknown> }) => ({ id: 'config-1', ...create }));
});

describe('módulos del rubro — contrato HTTP de #332', () => {
  it('200 — devuelve los ocho módulos, incluso los apagados, con su contrato declarativo', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: `/companies/${COMPANY_ID}/modulos-rubro` });
    expect(res.statusCode).toBe(200);
    const { data } = JSON.parse(res.body) as { data: Array<{ clave: string; estado: string; alertas: string[] }> };
    expect(data).toHaveLength(8);
    expect(data.find((modulo) => modulo.clave === 'produccion')).toMatchObject({ estado: 'prendido' });
    expect(data.find((modulo) => modulo.clave === 'depositos')).toMatchObject({ estado: 'apagado', alertas: ['nivel_deposito_bajo', 'humedad_ingreso', 'antiguedad_stock'] });
  });

  it('422 — no apaga un módulo si otro módulo prendido depende de él', async () => {
    mockPrisma.configuracionModuloRubro.findMany.mockResolvedValue([{ moduleId: 'variantes', activo: true }]);
    const app = await buildApp();
    const res = await app.inject({ method: 'PUT', url: `/companies/${COMPANY_ID}/modulos-rubro/produccion`, payload: { activo: false } });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toContain('Tipos de producto');
    expect(mockPrisma.configuracionModuloRubro.upsert).not.toHaveBeenCalled();
  });

  it('200 — una empresa sin rubro no recibe módulos avícolas', async () => {
    mockPrisma.company.findFirst.mockResolvedValue({ id: COMPANY_ID, userId: USER, industry: 'SERVICIOS' });
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: `/companies/${COMPANY_ID}/modulos-rubro` });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([]);
  });

  it('200 — apagar un módulo sólo guarda su estado: no borra los datos del negocio', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'PUT', url: `/companies/${COMPANY_ID}/modulos-rubro/alimento`, payload: { activo: false } });
    expect(res.statusCode).toBe(200);
    expect(mockPrisma.configuracionModuloRubro.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ moduleId: 'alimento', activo: false }),
      update: { activo: false },
    }));
  });
});
