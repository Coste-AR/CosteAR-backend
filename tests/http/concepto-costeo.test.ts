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
    conceptoCosteoImporte: { findMany: vi.fn(), create: vi.fn() },
    tramoSemifijo: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    tramoCosto: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    equilibrioTramosCalculo: { create: vi.fn() },
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
  mockPrisma.tramoCosto.findMany.mockResolvedValue([]);
  mockPrisma.conceptoCosteoImporte.findMany.mockResolvedValue([]);
});

describe('POST /companies/:companyId/tramos-costo', () => {
  it('400 — techoFisico sin techoFuente nombra el campo faltante', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: `/companies/${COMPANY_ID}/tramos-costo`,
      payload: {
        conceptoId: CONCEPTO_ID,
        desde: 0,
        hasta: 475.7,
        tipo: 'REEMPLAZA',
        importeFijo: 1780000,
        cmUnitaria: 2974,
        techoFisico: 475.7,
      },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.details).toContainEqual(expect.objectContaining({ field: 'techoFuente' }));
    expect(mockPrisma.tramoCosto.create).not.toHaveBeenCalled();
  });
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

describe('M3-03b — importes y punto de cierre HTTP', () => {
  const conceptos = [
    { id: '11111111-1111-4111-8111-111111111111', companyId: COMPANY_ID, userId: USER, clave: 'variable', descripcion: 'Variable', elemento: 'MP', comportamientoVolumen: 'VARIABLE', causaVariabilidad: 'volumen', erogable: true, horizonteErogableMeses: 1, evitable: null, nivelSegmentacion: null, segmentoId: null, rangoActividadDesde: null, rangoActividadHasta: null, periodId: null, structureId: null, confirmado: true, clasificadoPorUserId: USER, clasificadoEn: new Date(), createdAt: new Date(), updatedAt: new Date(), deletedAt: null },
    { id: '22222222-2222-4222-8222-222222222222', companyId: COMPANY_ID, userId: USER, clave: 'fijo_1', descripcion: 'Fijo mensual', elemento: 'CIP', comportamientoVolumen: 'FIJO', causaVariabilidad: 'tiempo', erogable: true, horizonteErogableMeses: 1, evitable: null, nivelSegmentacion: null, segmentoId: null, rangoActividadDesde: null, rangoActividadHasta: null, periodId: null, structureId: null, confirmado: true, clasificadoPorUserId: USER, clasificadoEn: new Date(), createdAt: new Date(), updatedAt: new Date(), deletedAt: null },
    { id: '33333333-3333-4333-8333-333333333333', companyId: COMPANY_ID, userId: USER, clave: 'fijo_12', descripcion: 'Fijo anual', elemento: 'CIP', comportamientoVolumen: 'FIJO', causaVariabilidad: 'tiempo', erogable: true, horizonteErogableMeses: 12, evitable: null, nivelSegmentacion: null, segmentoId: null, rangoActividadDesde: null, rangoActividadHasta: null, periodId: null, structureId: null, confirmado: true, clasificadoPorUserId: USER, clasificadoEn: new Date(), createdAt: new Date(), updatedAt: new Date(), deletedAt: null },
  ];
  const version = (conceptoId: string, fijo: number | null, variable: number | null, id: string) => ({ id, companyId: COMPANY_ID, userId: USER, conceptoId, importeFijo: fijo, importeVariableUnitario: variable, moneda: 'ARS', unidad: 'unidad', vigenteDesde: new Date('2026-01-01T00:00:00.000Z'), creadoPorUserId: USER, createdAt: new Date('2026-01-01T00:00:00.000Z') });

  it('GET devuelve AM-01: 375 a un mes, 593,75 a doce y situación a 650', async () => {
    mockPrisma.conceptoCosteo.findMany.mockResolvedValue(conceptos);
    mockPrisma.conceptoCosteoImporte.findMany.mockResolvedValue([
      version(conceptos[0].id, null, 244, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
      version(conceptos[1].id, 96000, null, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
      version(conceptos[2].id, 56000, null, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
    ]);
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: `/companies/${COMPANY_ID}/analisis/punto-cierre?horizontes=1,12&precioUnitario=500&puntoEquilibrioEconomico=750&actividad=650` });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data.horizontes).toEqual(expect.arrayContaining([
      expect.objectContaining({ horizonteMeses: 1, valor: 375 }),
      expect.objectContaining({ horizonteMeses: 12, valor: 593.75, situacion: 'pierde económicamente y sostiene la caja' }),
    ]));
  });

  it('GET declara ausencia y nombra el concepto sin importe', async () => {
    mockPrisma.conceptoCosteo.findMany.mockResolvedValue(conceptos);
    mockPrisma.conceptoCosteoImporte.findMany.mockResolvedValue([]);
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: `/companies/${COMPANY_ID}/analisis/punto-cierre?horizontes=1,12&precioUnitario=500&puntoEquilibrioEconomico=750` });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data.horizontes[0]).toMatchObject({ valor: null, motivoSinEquilibrio: expect.stringContaining('Variable') });
  });

  it('un importe anual faltante no invalida el horizonte de un mes', async () => {
    mockPrisma.conceptoCosteo.findMany.mockResolvedValue(conceptos);
    mockPrisma.conceptoCosteoImporte.findMany.mockResolvedValue([
      version(conceptos[0].id, null, 244, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
      version(conceptos[1].id, 96000, null, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
    ]);
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: `/companies/${COMPANY_ID}/analisis/punto-cierre?horizontes=1,12&precioUnitario=500&puntoEquilibrioEconomico=750` });
    const horizontes = JSON.parse(res.body).data.horizontes;
    expect(horizontes[0]).toMatchObject({ horizonteMeses: 1, valor: 375 });
    expect(horizontes[1]).toMatchObject({ horizonteMeses: 12, valor: null, motivoSinEquilibrio: expect.stringContaining('Fijo anual') });
  });

  it('POST exige la porción del comportamiento y no guarda', async () => {
    mockPrisma.conceptoCosteo.findFirst.mockResolvedValue(conceptos[0]);
    const app = await buildTestApp();
    const res = await app.inject({ method: 'POST', url: `/companies/${COMPANY_ID}/conceptos-costeo/${conceptos[0].id}/importes`, payload: { moneda: 'ARS', unidad: 'unidad', vigenteDesde: '2026-01-01T00:00:00.000Z' } });
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body).error.details).toMatchObject({ field: 'importeVariableUnitario' });
    expect(mockPrisma.conceptoCosteoImporte.create).not.toHaveBeenCalled();
  });
});

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
