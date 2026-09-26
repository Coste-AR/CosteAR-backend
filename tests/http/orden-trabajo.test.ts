import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';

const USER = '11111111-1111-1111-1111-111111111111';
const COMPANY = '33333333-3333-3333-3333-333333333333';
const ORDER = '44444444-4444-4444-4444-444444444444';
const { db, auth } = vi.hoisted(() => ({ auth: { role: 'EMPRESA_ADMIN' }, db: {
  company: { findFirst: vi.fn() },
  ordenTrabajo: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
  plantillaOrden: { findFirst: vi.fn(), findMany: vi.fn() },
  etapaOrden: { findFirst: vi.fn(), findMany: vi.fn() },
  versionPresupuesto: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
  parametroCosteo: { findFirst: vi.fn() },
  tarifaManoObra: { findFirst: vi.fn() },
  parteHoras: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
  costoDirectoOrden: { findMany: vi.fn(), create: vi.fn() },
  eventoContingencia: { findMany: vi.fn(), create: vi.fn() },
  traceAuditLog: { create: vi.fn() },
  operatorMembership: { findFirst: vi.fn() },
  operatorOrdenTrabajo: { findFirst: vi.fn(), findMany: vi.fn() },
} }));
vi.mock('@/infrastructure/database/prisma.js', () => ({
  prisma: db, withTenant: async (_id: string, fn: (tx: typeof db) => unknown) => fn(db),
}));
vi.mock('@/infrastructure/http/plugins/authenticate.js', () => ({
  authenticate: async (request: FastifyRequest, _reply: FastifyReply) => {
    request.authUser = { id: USER, tenantId: USER, role: auth.role, jobTitle: null };
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
  auth.role = 'EMPRESA_ADMIN';
  db.company.findFirst.mockResolvedValue({ id: COMPANY, userId: USER });
  db.ordenTrabajo.findFirst.mockResolvedValue(null);
  db.ordenTrabajo.create.mockResolvedValue({ id: ORDER, companyId: COMPANY, codigo: 'OT-001', descripcion: 'Obra X', cliente: 'Cliente ficticio', estado: 'BORRADOR' });
  db.plantillaOrden.findMany.mockResolvedValue([]);
  db.etapaOrden.findMany.mockResolvedValue([]);
  db.operatorMembership.findFirst.mockResolvedValue(null);
  db.operatorOrdenTrabajo.findMany.mockResolvedValue([]);
  db.versionPresupuesto.findFirst.mockResolvedValue(null);
  db.versionPresupuesto.findMany.mockResolvedValue([]);
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

  it('expone los modelos de la empresa', async () => {
    const api = await app();
    const res = await api.inject({ method: 'GET', url: `/companies/${COMPANY}/plantillas-orden` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: [] });
  });

  it('expone las etapas visibles de una orden', async () => {
    db.ordenTrabajo.findFirst.mockResolvedValue({ id: ORDER, userId: USER, estado: 'BORRADOR' });
    db.etapaOrden.findMany.mockResolvedValue([{ id: COMPANY, clave: 'montaje', nombre: 'Montaje', orden: 1, esEntrega: true }]);
    const api = await app();
    const res = await api.inject({ method: 'GET', url: `/ordenes-trabajo/${ORDER}/etapas` });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([expect.objectContaining({ nombre: 'Montaje', esEntrega: true })]);
  });

  it('un usuario de planta ve la orden sin precio ni margen', async () => {
    auth.role = 'EMPRESA_OPERATOR';
    db.operatorOrdenTrabajo.findFirst.mockResolvedValue({ orden: { userId: USER } });
    db.ordenTrabajo.findFirst.mockResolvedValue({
      id: ORDER, userId: USER, codigo: 'OT-001', descripcion: 'Obra X', cliente: 'Cliente ficticio',
      estado: 'EN_PRODUCCION', precio: 2_100_000,
      precioContractual: 2_250_000, margenReal: 700_000,
    });
    const api = await app();
    const res = await api.inject({ method: 'GET', url: `/ordenes-trabajo/${ORDER}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).not.toHaveProperty('precio');
    expect(res.json().data).not.toHaveProperty('precioContractual');
    expect(res.json().data).not.toHaveProperty('margenReal');
  });

  it('compras sin ordenes.cerrar recibe 403 al pasar a pendiente de cierre', async () => {
    auth.role = 'EMPRESA_OPERATOR';
    db.operatorOrdenTrabajo.findFirst.mockResolvedValue(null);
    const api = await app();
    const res = await api.inject({
      method: 'POST', url: `/ordenes-trabajo/${ORDER}/transiciones`, payload: { estado: 'PENDIENTE_CIERRE' },
    });
    expect(res.statusCode).toBe(403);
    expect(db.ordenTrabajo.update).not.toHaveBeenCalled();
  });

  it('aprobar un presupuesto vencido responde 400 tipado, no 500', async () => {
    db.versionPresupuesto.findFirst.mockResolvedValue({
      id: ORDER, userId: USER, estado: 'PREPARADO', preparadoPor: COMPANY,
      vigenteDesde: new Date('2026-01-01T00:00:00Z'), vigenciaDias: 7, renglones: [],
    });
    const api = await app();
    const res = await api.inject({ method: 'POST', url: `/presupuestos/${ORDER}/aprobar` });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('BUDGET_EXPIRED');
    expect(db.versionPresupuesto.update).not.toHaveBeenCalled();
  });

  it('un usuario de planta carga horas sin recibir tarifa ni importe', async () => {
    auth.role = 'EMPRESA_OPERATOR';
    db.operatorOrdenTrabajo.findFirst.mockResolvedValue({ orden: { userId: USER } });
    db.ordenTrabajo.findFirst.mockResolvedValue({ id: ORDER, companyId: COMPANY, userId: USER, company: { politicaPrimaExtra: 'DENTRO_DE_TARIFA' } });
    db.etapaOrden.findFirst.mockResolvedValue({ id: COMPANY, ordenId: ORDER, esEntrega: false });
    db.tarifaManoObra.findFirst.mockResolvedValue({ id: COMPANY, companyId: COMPANY, nombre: 'Taller', basicRemuneration: '650000', hoursWorked: '130', productiveHours: null, standardHours: null, itcsPct: '0', primaExtraPct: '50' });
    db.parteHoras.create.mockResolvedValue({ id: COMPANY, ordenId: ORDER, etapaId: COMPANY, personaId: USER, fecha: new Date('2026-09-25T00:00:00Z'), horasNormales: 8, horasExtra: 0, tarifaId: COMPANY, tarifaHora: 5000, primaExtraHora: 0, importeMod: null, estado: 'CARGADO' });
    const api = await app();
    const res = await api.inject({ method: 'POST', url: `/ordenes-trabajo/${ORDER}/partes-horas`, payload: {
      personaId: USER, etapaId: COMPANY, fecha: '2026-09-25', horasNormales: 8, horasExtra: 0, tarifaId: COMPANY,
    } });
    expect(res.statusCode).toBe(201);
    expect(res.json().data).not.toHaveProperty('tarifaHora');
    expect(res.json().data).not.toHaveProperty('importeMod');
  });

  it('rechaza una falla de proveedor sin recupero ni reclamo', async () => {
    const api = await app();
    const res = await api.inject({ method: 'POST', url: `/ordenes-trabajo/${ORDER}/contingencias`, payload: {
      etapaId: COMPANY, tipo: 'FALLA', cantidad: 1, valor: 50000, causa: 'Proveedor', tratamiento: 'Sin acción',
    } });
    expect(res.statusCode).toBe(400);
    expect(db.eventoContingencia.create).not.toHaveBeenCalled();
  });
});
