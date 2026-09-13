import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { PAQUETE_AVICOLA_POSTURA } from '@/application/operacion/paquete-avicola.js';

const USER = 'user-1';
const COMPANY_ID = '00000000-0000-0000-0000-000000000001';
const OTHER_COMPANY_ID = '00000000-0000-0000-0000-0000000000ff';
const STRUCTURE_ID = '11111111-1111-1111-1111-111111111111';
const COMPANY = { id: COMPANY_ID, userId: USER, industry: 'AVICULTURA', unidadGestionId: null };

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    company: { findFirst: vi.fn(), update: vi.fn() },
    costStructure: { findFirst: vi.fn() },
    costPeriod: { findFirst: vi.fn() },
    unidadMedida: { findFirst: vi.fn() },
    paqueteRubro: { findMany: vi.fn() },
    configuracionModuloRubro: { findMany: vi.fn() },
    parametroCosteo: {
      findMany: vi.fn(),
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
  const { registerParametrosCosteoRoutes } = await import(
    '@/infrastructure/http/routes/parametros-costeo.routes.js'
  );
  const { errorHandler } = await import('@/infrastructure/http/error-handler.js');
  const app = Fastify({ logger: false });
  app.setErrorHandler(errorHandler);
  await app.register(registerParametrosCosteoRoutes);
  await app.ready();
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.company.findFirst.mockResolvedValue(COMPANY);
  mockPrisma.paqueteRubro.findMany.mockResolvedValue([{
    category: 'AVICOLA_POSTURA', userId: null, companyId: null, structureId: null, periodId: null,
    ...PAQUETE_AVICOLA_POSTURA, scale: null,
  }]);
  mockPrisma.configuracionModuloRubro.findMany.mockResolvedValue([]);
  mockPrisma.unidadMedida.findFirst.mockResolvedValue(null);
  mockPrisma.parametroCosteo.findMany.mockResolvedValue([]);
  mockPrisma.parametroCosteo.findFirst.mockResolvedValue(null);
});

describe('GET /companies/:companyId/parametros-costeo', () => {
  it('200 — devuelve el catálogo completo resuelto a default cuando no hay filas cargadas', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'GET',
      url: `/companies/${COMPANY_ID}/parametros-costeo`,
    });

    expect(res.statusCode).toBe(200);
    const { data } = JSON.parse(res.body) as { data: { clave: string; origen: string }[] };
    expect(data.length).toBeGreaterThan(0);
    expect(data.every((p) => p.origen === 'default')).toBe(true);
  });

  it('expone los metadatos del catálogo que declaró el paquete', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'GET',
      url: `/companies/${COMPANY_ID}/parametros-costeo`,
    });

    const { data } = JSON.parse(res.body) as { data: Array<{ clave: string; opciones?: unknown[] }> };
    expect(data.find((p) => p.clave === 'unidad_carga')).toMatchObject({
      opciones: expect.arrayContaining([{ valor: 'cajon', etiqueta: 'Cajón' }]),
    });
  });

  it('404 cuando la empresa no es de quien pide', async () => {
    mockPrisma.company.findFirst.mockResolvedValue(null);
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'GET',
      url: `/companies/${OTHER_COMPANY_ID}/parametros-costeo`,
    });

    expect(res.statusCode).toBe(404);
  });
});

describe('GET /companies/:companyId/parametros-costeo/:clave', () => {
  it('200 — resuelve un parámetro puntual', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'GET',
      url: `/companies/${COMPANY_ID}/parametros-costeo/umbral_merma_normal_pct`,
    });

    expect(res.statusCode).toBe(200);
    const { data } = JSON.parse(res.body) as { data: { clave: string } };
    expect(data.clave).toBe('umbral_merma_normal_pct');
  });

  it('404 cuando la clave no existe en el catálogo', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'GET',
      url: `/companies/${COMPANY_ID}/parametros-costeo/no_existe`,
    });

    expect(res.statusCode).toBe(404);
  });
});

describe('PUT /companies/:companyId/parametros-costeo/:clave', () => {
  it('200 — carga un valor a nivel empresa y responde con la fila guardada', async () => {
    mockPrisma.parametroCosteo.create.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({ id: 'pc-1', ...data }),
    );
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'PUT',
      url: `/companies/${COMPANY_ID}/parametros-costeo/vida_util_lote_meses`,
      payload: { valor: 20, confirmado: false },
    });

    expect(res.statusCode).toBe(200);
    const { data } = JSON.parse(res.body) as { data: { valorNum: number; confirmado: boolean } };
    expect(data.valorNum).toBe(20);
    expect(data.confirmado).toBe(false);
  });

  it('400 cuando falta declarar `confirmado`', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'PUT',
      url: `/companies/${COMPANY_ID}/parametros-costeo/vida_util_lote_meses`,
      payload: { valor: 20 },
    });

    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(mockPrisma.parametroCosteo.create).not.toHaveBeenCalled();
  });

  it('422 cuando la clave no existe en el catálogo', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'PUT',
      url: `/companies/${COMPANY_ID}/parametros-costeo/no_existe`,
      payload: { valor: 1, confirmado: true },
    });

    expect(res.statusCode).toBe(422);
  });

  it('422 — rechaza una opción fuera de las declaradas por el paquete', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'PUT',
      url: `/companies/${COMPANY_ID}/parametros-costeo/unidad_carga`,
      payload: { valorTexto: 'bolsa', confirmado: true },
    });
    expect(res.statusCode).toBe(422);
    expect(mockPrisma.parametroCosteo.create).not.toHaveBeenCalled();
  });

  it('200 — guarda una opción válida como decisión confirmada', async () => {
    mockPrisma.parametroCosteo.create.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({ id: 'pc-texto', ...data }),
    );
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'PUT',
      url: `/companies/${COMPANY_ID}/parametros-costeo/unidad_carga`,
      payload: { valorTexto: 'cajon', confirmado: false },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ valorTexto: 'cajon', valorNum: null, confirmado: true });
  });

  it('422 — unidad_gestion no crea una unidad inexistente al vuelo', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'PUT',
      url: `/companies/${COMPANY_ID}/parametros-costeo/unidad_gestion`,
      payload: { valorTexto: 'cajon', confirmado: true },
    });
    expect(res.statusCode).toBe(422);
    expect(mockPrisma.company.update).not.toHaveBeenCalled();
  });

  it('200 — unidad_gestion apunta a una unidad propia existente', async () => {
    mockPrisma.unidadMedida.findFirst.mockResolvedValue({ id: 'unidad-cajon', codigo: 'cajon' });
    mockPrisma.company.update.mockResolvedValue({ id: COMPANY_ID, unidadGestionId: 'unidad-cajon' });
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'PUT',
      url: `/companies/${COMPANY_ID}/parametros-costeo/unidad_gestion`,
      payload: { valorTexto: 'cajon', confirmado: true },
    });
    expect(res.statusCode).toBe(200);
    expect(mockPrisma.company.update).toHaveBeenCalledWith({
      where: { id: COMPANY_ID }, data: { unidadGestionId: 'unidad-cajon' },
    });
  });

  it('404 cuando la estructura pasada no pertenece a la empresa', async () => {
    mockPrisma.costStructure.findFirst.mockResolvedValue(null);
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'PUT',
      url: `/companies/${COMPANY_ID}/parametros-costeo/vida_util_lote_meses`,
      payload: { valor: 20, confirmado: false, structureId: STRUCTURE_ID },
    });

    expect(res.statusCode).toBe(404);
  });
});

describe('DELETE /companies/:companyId/parametros-costeo/:clave', () => {
  it('200 — elimina el override y devuelve el valor del catálogo', async () => {
    mockPrisma.parametroCosteo.findFirst.mockResolvedValue({
      id: 'pc-1',
      clave: 'vida_util_lote_meses',
      valorNum: 24,
      structureId: null,
      periodId: null,
    });
    mockPrisma.parametroCosteo.update.mockResolvedValue({ id: 'pc-1', deletedAt: new Date() });
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'DELETE',
      url: `/companies/${COMPANY_ID}/parametros-costeo/vida_util_lote_meses`,
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data).toMatchObject({ valor: 24, origen: 'default', valorDefault: 24 });
    expect(mockPrisma.parametroCosteo.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { deletedAt: expect.any(Date) } }),
    );
  });

  it('es idempotente cuando no existe un override', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'DELETE',
      url: `/companies/${COMPANY_ID}/parametros-costeo/vida_util_lote_meses`,
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data.origen).toBe('default');
    expect(mockPrisma.parametroCosteo.update).not.toHaveBeenCalled();
  });
});
