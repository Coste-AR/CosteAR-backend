import { beforeEach, describe, expect, it, vi } from 'vitest';

const USER = '11111111-1111-1111-1111-111111111111';
const APPROVER = '22222222-2222-2222-2222-222222222222';
const COMPANY = '33333333-3333-3333-3333-333333333333';
const ORDER = '44444444-4444-4444-4444-444444444444';
const BUDGET = '55555555-5555-5555-5555-555555555555';

const { db, recordTraceAudit } = vi.hoisted(() => ({
  db: {
    ordenTrabajo: { findFirst: vi.fn() }, versionPresupuesto: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    parametroCosteo: { findFirst: vi.fn() }, traceAuditLog: { create: vi.fn() },
  }, recordTraceAudit: vi.fn(async () => undefined),
}));
vi.mock('@/infrastructure/database/prisma.js', () => ({ prisma: db, withTenant: async (_id: string, fn: (tx: typeof db) => unknown) => fn(db) }));
vi.mock('@/application/audit/trace-audit.js', () => ({ recordTraceAudit }));

const actor = (id: string) => ({ id, role: 'EMPRESA_ADMIN', area: 'costista', method: 'manual' });

describe('PresupuestoOrdenService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.ordenTrabajo.findFirst.mockResolvedValue({ id: ORDER, companyId: COMPANY, userId: USER });
    db.versionPresupuesto.findFirst.mockResolvedValue(null);
    db.parametroCosteo.findFirst.mockResolvedValue({ valorNum: 7 });
  });

  it('rechaza aprobar una base vencida sin revalidarla (test 17)', async () => {
    const { PresupuestoOrdenService } = await import('@/application/ordenes/presupuesto-orden-service.js');
    db.versionPresupuesto.findFirst.mockResolvedValue({
      id: BUDGET, userId: USER, estado: 'PREPARADO', preparadoPor: USER,
      vigenteDesde: new Date('2026-01-01T00:00:00Z'), vigenciaDias: 7, renglones: [],
    });
    await expect(new PresupuestoOrdenService(db as never).approve(USER, BUDGET, actor(APPROVER)))
      .rejects.toMatchObject({ code: 'BUDGET_EXPIRED', statusCode: 400 });
    expect(db.versionPresupuesto.update).not.toHaveBeenCalled();
  });

  it('rechaza que la misma persona prepare y apruebe', async () => {
    const { PresupuestoOrdenService } = await import('@/application/ordenes/presupuesto-orden-service.js');
    db.versionPresupuesto.findFirst.mockResolvedValue({
      id: BUDGET, userId: USER, estado: 'PREPARADO', preparadoPor: USER,
      vigenteDesde: new Date(), vigenciaDias: 7, renglones: [],
    });
    await expect(new PresupuestoOrdenService(db as never).approve(USER, BUDGET, actor(USER)))
      .rejects.toMatchObject({ code: 'SAME_PREPARER_AND_APPROVER' });
  });

  it('la base aprobada es inmutable porque ninguna transición vuelve a borrador (test 18)', async () => {
    const { PresupuestoOrdenService } = await import('@/application/ordenes/presupuesto-orden-service.js');
    db.versionPresupuesto.findFirst.mockResolvedValue({ id: BUDGET, userId: USER, estado: 'APROBADO', renglones: [] });
    await expect(new PresupuestoOrdenService(db as never).revalidate(USER, BUDGET, {}, actor(USER)))
      .rejects.toMatchObject({ code: 'INVALID_BUDGET_STATE' });
  });

  it('FX-OT suma base y adicional aprobados: precio 2.250.000 y costo 1.500.000', async () => {
    const { PresupuestoOrdenService } = await import('@/application/ordenes/presupuesto-orden-service.js');
    db.versionPresupuesto.findMany.mockResolvedValue([
      { id: BUDGET, tipo: 'BASE', estado: 'APROBADO', precio: '2100000', costoPrevisto: '1400000', renglones: [] },
      { id: APPROVER, tipo: 'ADICIONAL', estado: 'APROBADO', precio: '150000', costoPrevisto: '100000', renglones: [] },
      { id: USER, tipo: 'ADICIONAL', estado: 'PREPARADO', precio: '999999', costoPrevisto: '999999', renglones: [] },
    ]);
    const result = await new PresupuestoOrdenService(db as never).list(USER, ORDER);
    expect(result).toMatchObject({ precioContractual: 2_250_000, costoPrevistoTotal: 1_500_000 });
  });

  it('crea versión y auditoría en la misma transacción lógica', async () => {
    const { PresupuestoOrdenService } = await import('@/application/ordenes/presupuesto-orden-service.js');
    db.versionPresupuesto.create.mockResolvedValue({ id: BUDGET, estado: 'BORRADOR', renglones: [] });
    await new PresupuestoOrdenService(db as never).create(USER, ORDER, {
      tipo: 'BASE', costoPrevisto: 1_400_000, precio: 2_100_000, plazoDias: 30,
      renglones: [{ elemento: 'MP', cantidad: 1, unidadId: COMPANY, precio: 260_000 }],
    }, actor(USER));
    expect(recordTraceAudit).toHaveBeenCalledWith(expect.objectContaining({ entityType: 'VersionPresupuesto', action: 'create' }), db);
  });
});
