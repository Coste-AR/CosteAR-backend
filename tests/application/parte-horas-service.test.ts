import { beforeEach, describe, expect, it, vi } from 'vitest';

const USER = '11111111-1111-1111-1111-111111111111';
const ORDER = '22222222-2222-2222-2222-222222222222';
const STAGE = '33333333-3333-3333-3333-333333333333';
const RATE = '44444444-4444-4444-4444-444444444444';
const PART = '55555555-5555-5555-5555-555555555555';
const EXTRA = '66666666-6666-6666-6666-666666666666';

const { db, recordTraceAudit } = vi.hoisted(() => ({
  db: {
    ordenTrabajo: { findFirst: vi.fn() }, etapaOrden: { findFirst: vi.fn() }, tarifaManoObra: { findFirst: vi.fn() },
    versionPresupuesto: { findFirst: vi.fn() }, parteHoras: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
  },
  recordTraceAudit: vi.fn(async () => undefined),
}));
vi.mock('@/infrastructure/database/prisma.js', () => ({ prisma: db, withTenant: async (_id: string, fn: (tx: typeof db) => unknown) => fn(db) }));
vi.mock('@/application/audit/trace-audit.js', () => ({ recordTraceAudit }));

const actor = { id: USER, role: 'EMPRESA_ADMIN', area: 'costista', method: 'manual' };

describe('ParteHorasService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.ordenTrabajo.findFirst.mockResolvedValue({ id: ORDER, companyId: USER, userId: USER, company: { politicaPrimaExtra: 'DENTRO_DE_TARIFA' } });
    db.etapaOrden.findFirst.mockResolvedValue({ id: STAGE, ordenId: ORDER, esEntrega: false });
    db.tarifaManoObra.findFirst.mockResolvedValue({ id: RATE, companyId: USER, basicRemuneration: '650000', hoursWorked: '130', productiveHours: null, standardHours: null, itcsPct: '0', primaExtraPct: '50' });
    db.parteHoras.create.mockImplementation(async ({ data }: { data: object }) => ({ id: PART, estado: 'CARGADO', ...data }));
  });

  it('rechaza primero una prima directa sin adicional aprobado', async () => {
    const { ParteHorasService } = await import('@/application/ordenes/parte-horas-service.js');
    db.ordenTrabajo.findFirst.mockResolvedValue({ id: ORDER, companyId: USER, userId: USER, company: { politicaPrimaExtra: 'DIRECTA_CON_CAUSA' } });
    db.versionPresupuesto.findFirst.mockResolvedValue(null);
    await expect(new ParteHorasService(db as never).create(USER, ORDER, {
      personaId: USER, etapaId: STAGE, fecha: '2026-09-25', horasNormales: 120, horasExtra: 10,
      tarifaId: RATE, causaExtra: { texto: 'Adicional', versionPresupuestoId: EXTRA },
    }, actor)).rejects.toMatchObject({ code: 'EXTRA_CAUSE_NOT_APPROVED', statusCode: 422 });
    expect(db.parteHoras.create).not.toHaveBeenCalled();
  });

  it('FX-OT DIRECTA_CON_CAUSA imputa 675.000 al aprobar', async () => {
    const { ParteHorasService } = await import('@/application/ordenes/parte-horas-service.js');
    db.ordenTrabajo.findFirst.mockResolvedValue({ id: ORDER, companyId: USER, userId: USER, company: { politicaPrimaExtra: 'DIRECTA_CON_CAUSA' } });
    db.versionPresupuesto.findFirst.mockResolvedValue({ id: EXTRA, ordenId: ORDER, tipo: 'ADICIONAL', estado: 'APROBADO' });
    db.parteHoras.findFirst.mockResolvedValue({ id: PART, userId: USER, estado: 'CARGADO', horasNormales: '120', horasExtra: '10', tarifaHora: '5000', primaExtraHora: '2500' });
    db.parteHoras.update.mockResolvedValue({ id: PART, estado: 'APROBADO', importeMod: '675000' });
    const service = new ParteHorasService(db as never);
    await service.create(USER, ORDER, { personaId: USER, etapaId: STAGE, fecha: '2026-09-25', horasNormales: 120, horasExtra: 10, tarifaId: RATE, causaExtra: { texto: 'Adicional', versionPresupuestoId: EXTRA } }, actor);
    const approved = await service.approve(USER, PART, actor);
    expect(db.parteHoras.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ importeMod: 675000 }) }));
    expect(approved.importeMod).toBe(675000);
  });

  it('DENTRO_DE_TARIFA imputa 130 horas a 5.000 sin prima directa', async () => {
    const { ParteHorasService } = await import('@/application/ordenes/parte-horas-service.js');
    db.parteHoras.findFirst.mockResolvedValue({ id: PART, userId: USER, estado: 'CARGADO', horasNormales: '120', horasExtra: '10', tarifaHora: '5000', primaExtraHora: '0' });
    db.parteHoras.update.mockResolvedValue({ id: PART, estado: 'APROBADO', importeMod: '650000' });
    const approved = await new ParteHorasService(db as never).approve(USER, PART, actor);
    expect(db.parteHoras.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ importeMod: 650000 }) }));
    expect(approved.importeMod).toBe(650000);
  });
});
