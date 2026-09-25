import { beforeEach, describe, expect, it, vi } from 'vitest';

const USER = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';
const COMPANY = '33333333-3333-3333-3333-333333333333';
const ORDER = '44444444-4444-4444-4444-444444444444';

const { db, recordTraceAudit } = vi.hoisted(() => {
  const tx = {
    ordenTrabajo: { create: vi.fn(), update: vi.fn() },
    plantillaOrden: { findFirst: vi.fn(), findMany: vi.fn() },
    etapaOrden: { findMany: vi.fn() },
    traceAuditLog: { create: vi.fn() },
  };
  return {
    tx,
    db: {
      company: { findFirst: vi.fn() },
      ordenTrabajo: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
      plantillaOrden: { findFirst: vi.fn(), findMany: vi.fn() },
      etapaOrden: { findMany: vi.fn() },
      traceAuditLog: { create: vi.fn() },
      $transaction: vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
    },
    recordTraceAudit: vi.fn(async () => undefined),
  };
});

vi.mock('@/infrastructure/database/prisma.js', () => ({
  prisma: db,
  withTenant: async (_userId: string, fn: (client: typeof db) => unknown) => fn(db),
}));
vi.mock('@/application/audit/trace-audit.js', () => ({ recordTraceAudit }));

const actor = { id: USER, role: 'EMPRESA_ADMIN', area: 'costista', method: 'manual' };

describe('OrdenTrabajoService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.company.findFirst.mockResolvedValue({ id: COMPANY, userId: USER });
    db.ordenTrabajo.findFirst.mockResolvedValue(null);
  });

  it('rechaza primero un código repetido dentro de la empresa', async () => {
    const { OrdenTrabajoService } = await import('@/application/ordenes/orden-trabajo-service.js');
    db.ordenTrabajo.findFirst.mockResolvedValue({ id: ORDER });
    const service = new OrdenTrabajoService(db as never);

    await expect(service.create(USER, COMPANY, {
      codigo: 'OT-001', descripcion: 'Obra X', cliente: 'Cliente ficticio', plantillaId: null,
      fechaInicio: null,
    }, actor)).rejects.toMatchObject({ statusCode: 409 });
    expect(db.ordenTrabajo.create).not.toHaveBeenCalled();
  });

  it('permite el mismo código en otra empresa porque consulta el alcance compuesto', async () => {
    const { OrdenTrabajoService } = await import('@/application/ordenes/orden-trabajo-service.js');
    db.ordenTrabajo.create.mockResolvedValue({ id: ORDER, companyId: COMPANY, codigo: 'OT-001', estado: 'BORRADOR' });
    const service = new OrdenTrabajoService(db as never);

    await service.create(USER, COMPANY, {
      codigo: 'OT-001', descripcion: 'Obra X', cliente: 'Cliente ficticio', plantillaId: null,
      fechaInicio: null,
    }, actor);

    expect(db.ordenTrabajo.findFirst).toHaveBeenCalledWith({ where: { companyId: COMPANY, codigo: 'OT-001' } });
    expect(recordTraceAudit).toHaveBeenCalledOnce();
  });

  it('copia las etapas por defecto del paquete cuando no se eligió modelo', async () => {
    const { OrdenTrabajoService } = await import('@/application/ordenes/orden-trabajo-service.js');
    db.company.findFirst.mockResolvedValue({ id: COMPANY, userId: USER, industry: 'CONSTRUCCION_MODULAR' });
    db.ordenTrabajo.create.mockResolvedValue({ id: ORDER, companyId: COMPANY, codigo: 'OT-001', estado: 'BORRADOR', etapas: [] });
    const service = new OrdenTrabajoService(db as never);

    await service.create(USER, COMPANY, {
      codigo: 'OT-001', descripcion: 'Obra X', cliente: 'Cliente ficticio', plantillaId: null,
      fechaInicio: null,
    }, actor);

    const data = db.ordenTrabajo.create.mock.calls[0][0].data;
    expect(data.etapas.create).toHaveLength(7);
    expect(data.etapas.create.filter((etapa: { esEntrega: boolean }) => etapa.esEntrega)).toHaveLength(2);
  });

  it('rechaza saltar de BORRADOR a EN_PRODUCCION con error tipado', async () => {
    const { OrdenTrabajoService } = await import('@/application/ordenes/orden-trabajo-service.js');
    db.ordenTrabajo.findFirst.mockResolvedValue({ id: ORDER, userId: USER, estado: 'BORRADOR' });
    const service = new OrdenTrabajoService(db as never);

    await expect(service.transition(USER, ORDER, { estado: 'EN_PRODUCCION' }, actor))
      .rejects.toMatchObject({ statusCode: 400, code: 'INVALID_STATE_TRANSITION' });
  });

  it('audita una transición válida en la misma transacción', async () => {
    const { OrdenTrabajoService } = await import('@/application/ordenes/orden-trabajo-service.js');
    db.ordenTrabajo.findFirst.mockResolvedValue({ id: ORDER, userId: USER, estado: 'BORRADOR' });
    db.ordenTrabajo.update.mockResolvedValue({ id: ORDER, estado: 'COTIZADA' });
    const service = new OrdenTrabajoService(db as never);

    await service.transition(USER, ORDER, { estado: 'COTIZADA', motivo: 'Cotización emitida' }, actor);

    expect(recordTraceAudit).toHaveBeenCalledWith(expect.objectContaining({
      entityType: 'OrdenTrabajo', entityId: ORDER, action: 'transition',
      before: { estado: 'BORRADOR' }, after: { estado: 'COTIZADA' }, comment: 'Cotización emitida',
    }), db);
  });

  it('no encuentra una orden perteneciente a otra persona', async () => {
    const { OrdenTrabajoService } = await import('@/application/ordenes/orden-trabajo-service.js');
    db.ordenTrabajo.findFirst.mockResolvedValue(null);
    const service = new OrdenTrabajoService(db as never);
    await expect(service.get(OTHER, ORDER)).rejects.toMatchObject({ statusCode: 404 });
  });
});
