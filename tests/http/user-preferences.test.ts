import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { PAQUETE_AVICOLA_POSTURA } from '@/application/operacion/paquete-avicola.js';

const USER = '00000000-0000-0000-0000-000000000010';
const COMPANY = '00000000-0000-0000-0000-000000000020';

const { mockPrisma, tx } = vi.hoisted(() => {
  const transaction = {
    userPreference: { findUnique: vi.fn(), upsert: vi.fn() },
    auditLog: { create: vi.fn() },
    paqueteRubro: { findMany: vi.fn() },
  };
  return {
    tx: transaction,
    mockPrisma: {
      company: { findFirst: vi.fn() },
      paqueteRubro: { findMany: vi.fn() },
      configuracionModuloRubro: { findMany: vi.fn() },
      userPreference: { findUnique: vi.fn() },
      $transaction: vi.fn(async (fn: (client: typeof transaction) => unknown) => fn(transaction)),
    },
  };
});

vi.mock('@/infrastructure/database/prisma.js', () => ({
  prisma: mockPrisma,
  withTenant: async (_userId: string, fn: (client: typeof tx) => unknown) => fn(tx),
}));
vi.mock('@/infrastructure/http/plugins/authenticate.js', () => ({
  authenticate: async (request: FastifyRequest, _reply: FastifyReply) => {
    (request as FastifyRequest & { authUser: object }).authUser = { id: USER, role: 'EMPRESA_ADMIN' };
  },
  auditContext: () => ({ ipAddress: '127.0.0.1', userAgent: 'test' }),
}));

async function buildApp() {
  const Fastify = (await import('fastify')).default;
  const { registerUserPreferencesRoutes } = await import('@/infrastructure/http/routes/user-preferences.routes.js');
  const { errorHandler } = await import('@/infrastructure/http/error-handler.js');
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(errorHandler);
  await app.register(registerUserPreferencesRoutes);
  await app.ready();
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.company.findFirst.mockResolvedValue({ id: COMPANY, userId: USER, industry: 'AVICULTURA' });
  mockPrisma.paqueteRubro.findMany.mockResolvedValue([{
    category: 'AVICOLA_POSTURA', userId: null, companyId: null, structureId: null, periodId: null,
    ...PAQUETE_AVICOLA_POSTURA, scale: null,
  }]);
  tx.paqueteRubro.findMany.mockResolvedValue([{
    category: 'AVICOLA_POSTURA', userId: null, companyId: null, structureId: null, periodId: null,
    ...PAQUETE_AVICOLA_POSTURA, scale: null,
  }]);
  mockPrisma.configuracionModuloRubro.findMany.mockResolvedValue([]);
  mockPrisma.userPreference.findUnique.mockResolvedValue(null);
  tx.userPreference.findUnique.mockResolvedValue(null);
  tx.userPreference.upsert.mockImplementation(async ({ create }: { create: Record<string, unknown> }) => ({ id: 'pref-1', ...create }));
});

describe('preferencias de accesos rápidos — contrato HTTP de #389', () => {
  it('GET sin fila devuelve el default del catálogo y no 404', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/me/preferencias' });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().data).toEqual({
      home: { accesosRapidos: ['carga.produccion-diaria', 'carga.bajas-plantel'] },
    });
  });

  it('GET catálogo devuelve destinos no vacíos y oculta módulos apagados', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/me/preferencias/catalogo' });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toContainEqual({
      clave: 'carga.produccion-diaria', etiqueta: 'Producción diaria', modulo: 'produccion',
      porDefecto: true, destino: '/panel-campo',
    });
    expect(response.json().data.every((item: { destino: string }) => item.destino.length > 0)).toBe(true);
    expect(response.json().data.some((item: { clave: string }) => item.clave === 'carga.depositos')).toBe(false);
  });

  it('GET catálogo omite una superficie sin destino y conserva el resto', async () => {
    const modulos = PAQUETE_AVICOLA_POSTURA.modulos.map((modulo) => modulo.clave === 'produccion'
      ? {
          ...modulo,
          superficies: ['carga.produccion-diaria', 'carga.sin-pantalla'],
          destinos: { 'carga.produccion-diaria': '/panel-campo' },
        }
      : modulo);
    mockPrisma.paqueteRubro.findMany.mockResolvedValueOnce([{
      category: 'AVICOLA_POSTURA', userId: null, companyId: null, structureId: null, periodId: null,
      ...PAQUETE_AVICOLA_POSTURA, modulos, scale: null,
    }]);
    const app = await buildApp();

    const response = await app.inject({ method: 'GET', url: '/me/preferencias/catalogo' });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.some((item: { clave: string }) => item.clave === 'carga.produccion-diaria')).toBe(true);
    expect(response.json().data.some((item: { clave: string }) => item.clave === 'carga.sin-pantalla')).toBe(false);
  });

  it('PUT rechaza con 422 y nombra una clave fuera del catálogo', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'PUT', url: '/me/preferencias',
      payload: { home: { accesosRapidos: ['widget.inventado'] } },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().error.message).toContain('widget.inventado');
    expect(tx.userPreference.upsert).not.toHaveBeenCalled();
  });

  it('PUT rechaza con 422 un widget cuyo módulo está apagado', async () => {
    mockPrisma.configuracionModuloRubro.findMany.mockResolvedValueOnce([
      { moduleId: 'produccion', activo: false },
    ]);
    const app = await buildApp();
    const response = await app.inject({
      method: 'PUT', url: '/me/preferencias',
      payload: { home: { accesosRapidos: ['carga.produccion-diaria'] } },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().error.message).toContain('carga.produccion-diaria');
    expect(response.json().error.message).toContain('apagado');
  });

  it('PUT conserva el orden y audita en la misma transacción', async () => {
    const app = await buildApp();
    const accesosRapidos = ['carga.bajas-plantel', 'carga.produccion-diaria'];
    const response = await app.inject({ method: 'PUT', url: '/me/preferencias', payload: { home: { accesosRapidos } } });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.home.accesosRapidos).toEqual(accesosRapidos);
    expect(tx.userPreference.upsert).toHaveBeenCalled();
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'user.preferences.update', userId: USER }),
    }));
  });
});
