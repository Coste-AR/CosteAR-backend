import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import Fastify from 'fastify';
import { registerReglaAlertaRoutes } from '@/infrastructure/http/routes/regla-alerta.routes.js';
import { errorHandler } from '@/infrastructure/http/error-handler.js';

const USER = 'user-1';
const COMPANY_ID = '00000000-0000-0000-0000-000000000001';
const RULE_ID = '11111111-1111-1111-1111-111111111111';

const { mockPrisma, sendIndicatorAlert } = vi.hoisted(() => ({
  sendIndicatorAlert: vi.fn(async () => undefined),
  mockPrisma: {
    company: { findFirst: vi.fn() },
    costStructure: { findFirst: vi.fn() },
    unidadMedida: { findFirst: vi.fn() },
    reglaAlerta: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    alert: { create: vi.fn(), update: vi.fn() },
    traceAuditLog: { create: vi.fn() },
  },
}));

vi.mock('@/infrastructure/email/email-service.js', () => ({
  EmailService: class {
    sendIndicatorAlert = sendIndicatorAlert;
  },
}));

vi.mock('@/infrastructure/database/prisma.js', () => ({
  prisma: mockPrisma,
  withTenant: async (_userId: string, fn: (tx: unknown) => unknown) => fn(mockPrisma),
}));

vi.mock('@/application/audit/trace-audit.js', () => ({
  recordTraceAudit: vi.fn(async () => undefined),
}));

vi.mock('@/infrastructure/http/plugins/authenticate.js', () => ({
  authenticate: async (request: FastifyRequest, _reply: FastifyReply) => {
    (request as FastifyRequest & { authUser: object }).authUser = {
      id: USER,
      role: 'EMPRESA_ADMIN',
      jobTitle: null,
    };
  },
}));

async function buildTestApp() {
  const app = Fastify({ logger: false });
  app.setErrorHandler(errorHandler);
  await app.register(registerReglaAlertaRoutes);
  await app.ready();
  return app;
}

function filaRegla(overrides: Record<string, unknown> = {}) {
  return {
    id: RULE_ID,
    companyId: COMPANY_ID,
    userId: USER,
    structureId: null,
    indicador: 'humedad_grano_ingreso',
    descripcion: 'Humedad del grano al ingreso',
    condicion: 'MAYOR',
    umbral: 16,
    unidadId: null,
    unidad: null,
    lecturasSostenidas: 1,
    severidad: 'CRITICA',
    destinatarios: [],
    canal: 'IN_APP',
    activa: true,
    createdAt: new Date('2026-09-19T10:00:00.000Z'),
    updatedAt: new Date('2026-09-19T10:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.company.findFirst.mockResolvedValue({
    id: COMPANY_ID,
    userId: USER,
    name: 'Empresa ficticia',
    user: { email: 'costista@example.com' },
  });
  mockPrisma.reglaAlerta.findMany.mockResolvedValue([]);
  mockPrisma.reglaAlerta.findFirst.mockResolvedValue(null);
});

describe('reglas de alerta por indicador físico', () => {
  it('crea una regla con umbral, severidad, destinatarios y canal configurables', async () => {
    mockPrisma.reglaAlerta.create.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => filaRegla(data),
    );
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: `/companies/${COMPANY_ID}/alert-rules`,
      payload: {
        indicador: 'humedad_grano_ingreso',
        descripcion: 'Humedad del grano al ingreso',
        condicion: 'MAYOR',
        umbral: 17.5,
        severidad: 'CRITICA',
        destinatarios: ['dueno@example.com'],
        canal: 'EMAIL',
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().data).toMatchObject({
      umbral: 17.5,
      severidad: 'CRITICA',
      destinatarios: ['dueno@example.com'],
      canal: 'EMAIL',
    });
  });

  it('explica por qué no puede evaluar cuando faltan lecturas', async () => {
    mockPrisma.reglaAlerta.findFirst.mockResolvedValue(filaRegla());
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: `/companies/${COMPANY_ID}/alert-rules/${RULE_ID}/evaluate`,
      payload: { lecturas: [] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({
      estado: 'NO_EVALUABLE',
      motivo: expect.stringMatching(/falta una lectura/i),
      alerta: null,
    });
    expect(mockPrisma.alert.create).not.toHaveBeenCalled();
  });

  it('crea una alerta visible en la app cuando la lectura supera el umbral', async () => {
    mockPrisma.reglaAlerta.findFirst.mockResolvedValue(filaRegla());
    mockPrisma.alert.create.mockResolvedValue({ id: 'alert-1', type: 'INDICADOR_FISICO' });
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: `/companies/${COMPANY_ID}/alert-rules/${RULE_ID}/evaluate`,
      payload: { lecturas: [{ fecha: '2026-09-19T12:00:00.000Z', valor: 19 }] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ estado: 'ALERTA', alerta: { id: 'alert-1' } });
    expect(mockPrisma.alert.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: USER,
        companyId: COMPANY_ID,
        type: 'INDICADOR_FISICO',
        threshold: 16,
        actualValue: 19,
      }),
    });
  });

  it('envía email al destinatario configurado y registra la entrega', async () => {
    mockPrisma.reglaAlerta.findFirst
      .mockResolvedValueOnce(filaRegla({ canal: 'EMAIL', destinatarios: ['dueno@example.com'] }))
      .mockResolvedValueOnce({ canal: 'EMAIL', destinatarios: ['dueno@example.com'] });
    mockPrisma.alert.create.mockResolvedValue({ id: 'alert-2', type: 'INDICADOR_FISICO' });
    mockPrisma.alert.update.mockResolvedValue({
      id: 'alert-2',
      type: 'INDICADOR_FISICO',
      emailSentAt: new Date('2026-09-19T12:01:00.000Z'),
    });
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: `/companies/${COMPANY_ID}/alert-rules/${RULE_ID}/evaluate`,
      payload: { lecturas: [{ fecha: '2026-09-19T12:00:00.000Z', valor: 19 }] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.entrega).toMatchObject({ canal: 'EMAIL', destinatarios: 1 });
    expect(sendIndicatorAlert).toHaveBeenCalledWith(
      'dueno@example.com',
      'Empresa ficticia',
      expect.stringMatching(/por encima del límite/i),
    );
    expect(mockPrisma.alert.update).toHaveBeenCalledWith({
      where: { id: 'alert-2' },
      data: { emailSentAt: expect.any(Date) },
    });
  });

  it('conserva la alerta en la app y declara la falla si el email no sale', async () => {
    mockPrisma.reglaAlerta.findFirst
      .mockResolvedValueOnce(filaRegla({ canal: 'EMAIL', destinatarios: [] }))
      .mockResolvedValueOnce({ canal: 'EMAIL', destinatarios: [] });
    mockPrisma.alert.create.mockResolvedValue({ id: 'alert-3', type: 'INDICADOR_FISICO' });
    sendIndicatorAlert.mockRejectedValueOnce(new Error('proveedor no disponible'));
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: `/companies/${COMPANY_ID}/alert-rules/${RULE_ID}/evaluate`,
      payload: { lecturas: [{ fecha: '2026-09-19T12:00:00.000Z', valor: 19 }] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({
      estado: 'ALERTA',
      alerta: { id: 'alert-3' },
      entrega: {
        canal: 'EMAIL',
        estado: 'FALLIDA',
        motivo: expect.stringMatching(/quedó en la app/i),
      },
    });
    expect(sendIndicatorAlert).toHaveBeenCalledWith(
      'costista@example.com',
      'Empresa ficticia',
      expect.any(String),
    );
    expect(mockPrisma.alert.update).not.toHaveBeenCalled();
  });

  it('rechaza destinatarios que no son emails', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: `/companies/${COMPANY_ID}/alert-rules`,
      payload: {
        indicador: 'dias_estiba',
        descripcion: 'Días de almacenamiento',
        condicion: 'MAYOR',
        umbral: 14,
        destinatarios: ['sin-email'],
      },
    });
    expect(res.statusCode).toBe(400);
    expect(mockPrisma.reglaAlerta.create).not.toHaveBeenCalled();
  });
});
