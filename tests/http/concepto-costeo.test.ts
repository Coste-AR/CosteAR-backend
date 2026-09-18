import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyRequest, FastifyReply } from 'fastify';

const USER = 'user-1';
const COMPANY_ID = '00000000-0000-0000-0000-000000000001';
const COMPANY = { id: COMPANY_ID, userId: USER };

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    company: { findFirst: vi.fn() },
    costStructure: { findFirst: vi.fn() },
    costPeriod: { findFirst: vi.fn() },
    conceptoCosteo: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    tramoSemifijo: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
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
      role: 'COSTISTA',
      jobTitle: null,
    };
  },
}));

async function buildTestApp() {
  const Fastify = (await import('fastify')).default;
  const { registerConceptoCosteoRoutes } = await import(
    '@/infrastructure/http/routes/concepto-costeo.routes.js'
  );
  const { errorHandler } = await import('@/infrastructure/http/error-handler.js');
  const app = Fastify({ logger: false });
  app.setErrorHandler(errorHandler);
  await app.register(registerConceptoCosteoRoutes);
  await app.ready();
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.company.findFirst.mockResolvedValue(COMPANY);
  mockPrisma.conceptoCosteo.findMany.mockResolvedValue([]);
  mockPrisma.conceptoCosteo.findFirst.mockResolvedValue(null);
});

describe('GET /companies/:companyId/conceptos-costeo', () => {
  it('200 — vacío cuando no hay conceptos cargados', async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: `/companies/${COMPANY_ID}/conceptos-costeo` });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ data: [] });
  });
});

describe('POST /companies/:companyId/conceptos-costeo', () => {
  it('201 — crea un concepto', async () => {
    mockPrisma.conceptoCosteo.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'cc-1', ...data,
    }));
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: `/companies/${COMPANY_ID}/conceptos-costeo`,
      payload: { clave: 'energia_planta', elemento: 'CIP', comportamientoVolumen: 'VARIABLE', causaVariabilidad: 'volumen', confirmado: true },
    });
    expect(res.statusCode).toBe(201);
    const { data } = JSON.parse(res.body) as { data: { clave: string } };
    expect(data.clave).toBe('energia_planta');
  });

  it('422 — VARIABLE con causa distinta de volumen (R4/R8)', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: `/companies/${COMPANY_ID}/conceptos-costeo`,
      payload: { clave: 'amortizacion_plantel', elemento: 'CIP', comportamientoVolumen: 'VARIABLE', causaVariabilidad: 'tiempo', confirmado: true },
    });
    expect(res.statusCode).toBe(422);
    const body = JSON.parse(res.body) as { error: { code: string; message: string } };
    expect(body.error.message).toMatch(/R4|R8/);
  });

  it('400 — clave con mayúsculas o espacios rechazada por el schema', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: `/companies/${COMPANY_ID}/conceptos-costeo`,
      payload: { clave: 'Energia Planta', elemento: 'CIP', confirmado: false },
    });
    expect(res.statusCode).toBe(400);
  });
});

const CONCEPTO_ID = '22222222-2222-2222-2222-222222222222';

describe('PUT /companies/:companyId/conceptos-costeo/:id', () => {
  it('200 — actualiza la clasificación', async () => {
    const existente = { id: CONCEPTO_ID, companyId: COMPANY_ID, clave: 'energia_planta', elemento: 'CIP', comportamientoVolumen: null, causaVariabilidad: null };
    mockPrisma.conceptoCosteo.findFirst.mockResolvedValue(existente);
    mockPrisma.conceptoCosteo.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...existente, ...data }));
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'PUT',
      url: `/companies/${COMPANY_ID}/conceptos-costeo/${CONCEPTO_ID}`,
      payload: { comportamientoVolumen: 'VARIABLE', causaVariabilidad: 'volumen', confirmado: true },
    });
    expect(res.statusCode).toBe(200);
  });

  it('404 — concepto inexistente', async () => {
    mockPrisma.conceptoCosteo.findFirst.mockResolvedValue(null);
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'PUT',
      url: `/companies/${COMPANY_ID}/conceptos-costeo/00000000-0000-0000-0000-000000000099`,
      payload: { confirmado: true },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('DELETE /companies/:companyId/conceptos-costeo/:id', () => {
  it('200 — borra lógicamente', async () => {
    const existente = { id: CONCEPTO_ID, companyId: COMPANY_ID, clave: 'energia_planta' };
    mockPrisma.conceptoCosteo.findFirst.mockResolvedValue(existente);
    mockPrisma.conceptoCosteo.update.mockResolvedValue({ ...existente, deletedAt: new Date() });
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'DELETE',
      url: `/companies/${COMPANY_ID}/conceptos-costeo/${CONCEPTO_ID}`,
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('tramo semifijo de un concepto', () => {
  const concepto = {
    id: CONCEPTO_ID,
    companyId: COMPANY_ID,
    clave: 'energia_planta',
    comportamientoVolumen: 'SEMIFIJO',
    deletedAt: null,
  };

  it('POST calcular — muestra PUNTOS_EXTREMOS antes de guardar', async () => {
    mockPrisma.conceptoCosteo.findFirst.mockResolvedValue(concepto);
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: `/companies/${COMPANY_ID}/conceptos-costeo/${CONCEPTO_ID}/tramo-semifijo/calcular`,
      payload: {
        importe: 90000,
        metodo: 'PUNTOS_EXTREMOS',
        observacionesBase: [
          { volumen: 100, importe: 60000 },
          { volumen: 200, importe: 90000 },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data).toMatchObject({
      porcionFija: 30000,
      porcionVariable: 60000,
      costoVariableUnitario: 300,
    });
    expect(mockPrisma.tramoSemifijo.create).not.toHaveBeenCalled();
  });

  it('PUT — 422 si fija + variable no da el importe', async () => {
    mockPrisma.conceptoCosteo.findFirst.mockResolvedValue(concepto);
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'PUT',
      url: `/companies/${COMPANY_ID}/conceptos-costeo/${CONCEPTO_ID}/tramo-semifijo`,
      payload: { importe: 90000, metodo: 'DECLARADO', porcionFija: 54000, porcionVariable: 35000 },
    });
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body).error.message).toMatch(/no se ajusta en silencio/i);
    expect(mockPrisma.tramoSemifijo.create).not.toHaveBeenCalled();
  });

  it('PUT — guarda 54.000 / 36.000 y conserva el método', async () => {
    mockPrisma.conceptoCosteo.findFirst.mockResolvedValue(concepto);
    mockPrisma.tramoSemifijo.findFirst.mockResolvedValue(null);
    mockPrisma.tramoSemifijo.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'tramo-1',
      ...data,
      createdAt: new Date(),
      deletedAt: null,
    }));
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'PUT',
      url: `/companies/${COMPANY_ID}/conceptos-costeo/${CONCEPTO_ID}/tramo-semifijo`,
      payload: { importe: 90000, metodo: 'DECLARADO', porcionFija: 54000, porcionVariable: 36000 },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data).toMatchObject({
      metodo: 'DECLARADO', porcionFija: 54000, porcionVariable: 36000,
    });
  });
});
