import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';

const USER_ID = '00000000-0000-0000-0000-000000000001';
const COMPANY_ID = '00000000-0000-0000-0000-000000000002';

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    company: { findFirst: vi.fn() },
    operatorMembership: { findFirst: vi.fn() },
    panelTelemetryEvent: { create: vi.fn() },
  },
}));

vi.mock('@/infrastructure/database/prisma.js', () => ({
  prisma: mockPrisma,
  withTenant: async (_userId: string, fn: (tx: typeof mockPrisma) => unknown) => fn(mockPrisma),
}));
vi.mock('@/infrastructure/http/plugins/authenticate.js', () => ({
  authenticate: async (request: FastifyRequest, _reply: FastifyReply) => {
    request.authUser = { id: USER_ID, tenantId: USER_ID, role: 'COSTISTA' };
  },
}));

async function buildApp() {
  const Fastify = (await import('fastify')).default;
  const { registerTelemetriaPanelRoutes } = await import('@/infrastructure/http/routes/telemetria-panel.routes.js');
  const { errorHandler } = await import('@/infrastructure/http/error-handler.js');
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(errorHandler);
  await app.register(registerTelemetriaPanelRoutes);
  await app.ready();
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.company.findFirst.mockResolvedValue({ id: COMPANY_ID, userId: USER_ID });
  mockPrisma.panelTelemetryEvent.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: 'event-1',
    ...data,
    createdAt: new Date('2026-09-20T11:00:00.000Z'),
  }));
});

describe('telemetría anónima del panel de campo — #354', () => {
  it('201 — persiste una carga completada sin identidad personal', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: `/companies/${COMPANY_ID}/telemetria-panel`,
      payload: {
        tipo: 'CARGA_COMPLETADA',
        accion: 'carga.produccion-diaria.guardar',
        duracionMs: 42_000,
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().data).toMatchObject({
      tipo: 'CARGA_COMPLETADA',
      accion: 'carga.produccion-diaria.guardar',
      duracionMs: 42_000,
      rolTecnico: 'COSTISTA',
      registradoEn: '2026-09-20T11:00:00.000Z',
    });
    expect(mockPrisma.panelTelemetryEvent.create).toHaveBeenCalledWith({ data: {
      companyId: COMPANY_ID,
      userId: USER_ID,
      type: 'CARGA_COMPLETADA',
      action: 'carga.produccion-diaria.guardar',
      durationMs: 42_000,
      technicalRole: 'COSTISTA',
    } });
  });

  it.each([
    ['importe', 125_000],
    ['cantidad', 40],
    ['nombre', 'Persona Ejemplo'],
    ['personaId', '00000000-0000-0000-0000-000000000099'],
  ])('400 — rechaza el campo prohibido %s y no persiste', async (field, value) => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: `/companies/${COMPANY_ID}/telemetria-panel`,
      payload: { tipo: 'ACCION_TOCADA', accion: 'carga.abrir', [field]: value },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
    expect(mockPrisma.panelTelemetryEvent.create).not.toHaveBeenCalled();
  });

  it('400 — una carga abandonada exige duración', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: `/companies/${COMPANY_ID}/telemetria-panel`,
      payload: { tipo: 'CARGA_ABANDONADA', accion: 'carga.produccion-diaria' },
    });

    expect(response.statusCode).toBe(400);
    expect(mockPrisma.panelTelemetryEvent.create).not.toHaveBeenCalled();
  });
});
