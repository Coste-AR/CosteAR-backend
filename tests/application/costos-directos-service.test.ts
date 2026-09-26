import { beforeEach, describe, expect, it, vi } from 'vitest';

const USER = '11111111-1111-1111-1111-111111111111';
const ORDER = '22222222-2222-2222-2222-222222222222';
const STAGE = '33333333-3333-3333-3333-333333333333';
const EXTRA = '44444444-4444-4444-4444-444444444444';
const actor = { id: USER, role: 'EMPRESA_ADMIN', area: 'costista', method: 'manual' };
const { db, recordTraceAudit } = vi.hoisted(() => ({
  db: {
    ordenTrabajo: { findFirst: vi.fn() }, etapaOrden: { findFirst: vi.fn() }, versionPresupuesto: { findFirst: vi.fn() },
    costoDirectoOrden: { create: vi.fn(), findMany: vi.fn() }, eventoContingencia: { create: vi.fn(), findMany: vi.fn() },
  }, recordTraceAudit: vi.fn(async () => undefined),
}));
vi.mock('@/infrastructure/database/prisma.js', () => ({ prisma: db, withTenant: async (_id: string, fn: (tx: typeof db) => unknown) => fn(db) }));
vi.mock('@/application/audit/trace-audit.js', () => ({ recordTraceAudit }));

describe('CostosDirectosService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.ordenTrabajo.findFirst.mockResolvedValue({ id: ORDER, userId: USER, company: { politicaRetrabajo: 'CIF_POOL' } });
    db.etapaOrden.findFirst.mockResolvedValue({ id: STAGE, ordenId: ORDER, esEntrega: true });
  });

  it('rechaza primero un costo directo sin ordenId', async () => {
    const { CostosDirectosService } = await import('@/application/ordenes/costos-directos-service.js');
    db.ordenTrabajo.findFirst.mockResolvedValue(null);
    await expect(new CostosDirectosService(db as never).createCosto(USER, '', { etapaId: STAGE, categoria: 'TRANSPORTE', importe: 180000, periodoImputado: '2026-09-01' }, actor)).rejects.toMatchObject({ statusCode: 404 });
    expect(db.costoDirectoOrden.create).not.toHaveBeenCalled();
  });

  it('FX-OT separa 290.000 validados de entrega e instalación', async () => {
    const { CostosDirectosService } = await import('@/application/ordenes/costos-directos-service.js');
    db.ordenTrabajo.findFirst.mockResolvedValue({ id: ORDER });
    db.costoDirectoOrden.findMany.mockResolvedValue([
      { id: USER, ordenId: ORDER, etapaId: STAGE, importe: '180000', estadoValidacion: 'VALIDADO', etapa: { esEntrega: true } },
      { id: EXTRA, ordenId: ORDER, etapaId: STAGE, importe: '80000', estadoValidacion: 'VALIDADO', etapa: { esEntrega: true } },
      { id: STAGE, ordenId: ORDER, etapaId: STAGE, importe: '30000', estadoValidacion: 'VALIDADO', etapa: { esEntrega: true } },
      { id: ORDER, ordenId: ORDER, etapaId: STAGE, importe: '50000', estadoValidacion: 'PENDIENTE', etapa: { esEntrega: true } },
    ]);
    const result = await new CostosDirectosService(db as never).listCostos(USER, ORDER);
    expect(result.resumen).toEqual({ totalValidado: 290000, entregaInstalacionValidada: 290000 });
  });

  it('marca cambio del cliente sin adicional aprobado', async () => {
    const { CostosDirectosService } = await import('@/application/ordenes/costos-directos-service.js');
    db.ordenTrabajo.findFirst.mockResolvedValue({ id: ORDER, company: { politicaRetrabajo: 'CAMBIO_CLIENTE' } });
    db.versionPresupuesto.findFirst.mockResolvedValue(null);
    db.eventoContingencia.create.mockImplementation(async ({ data }: { data: object }) => ({ id: EXTRA, recupero: null, ...data }));
    const result = await new CostosDirectosService(db as never).createContingencia(USER, ORDER, { etapaId: STAGE, tipo: 'RETRABAJO', cantidad: 8, valor: 50000, causa: 'Cambio solicitado', tratamiento: 'Adicional' }, actor);
    expect(result.estadoValidacion).toBe('MARCADO');
  });

  it('PERDIDA_PERIODO deja 50.000 fuera del costo de la orden', async () => {
    const { CostosDirectosService } = await import('@/application/ordenes/costos-directos-service.js');
    db.ordenTrabajo.findFirst.mockResolvedValue({ id: ORDER });
    db.eventoContingencia.findMany.mockResolvedValue([{ id: EXTRA, ordenId: ORDER, etapaId: STAGE, tipo: 'RETRABAJO', politicaRetrabajo: 'PERDIDA_PERIODO', cantidad: '8', valor: '50000', recupero: null, estadoValidacion: 'VALIDADO' }]);
    const result = await new CostosDirectosService(db as never).listContingencias(USER, ORDER);
    expect(result.resumen).toEqual({ perdidaPeriodoValidada: 50000, cifPoolValidado: 0, adicionalValidado: 0 });
  });
});
