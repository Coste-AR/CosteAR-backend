import { describe, expect, it, vi } from 'vitest';
import { InventarioService } from '@/application/inventario/inventario-service.js';

const USER = '11111111-1111-4111-8111-111111111111';
const COMPANY = '22222222-2222-4222-8222-222222222222';
const ARTICLE = '33333333-3333-4333-8333-333333333333';
const ORDER = '44444444-4444-4444-8444-444444444444';
const actor = { id: USER, role: 'EMPRESA_ADMIN', area: 'costista', method: 'manual' };

function database(articleCompany = COMPANY, politicaPpp: 'MOVIL' | 'PERIODO' = 'MOVIL') {
  const tx = {
    company: { findFirst: vi.fn().mockResolvedValue({ id: COMPANY, politicaPpp }) },
    articulo: { findFirst: vi.fn().mockResolvedValue(articleCompany === COMPANY ? { id: ARTICLE, companyId: articleCompany } : null) },
    ordenTrabajo: { findFirst: vi.fn().mockResolvedValue({ id: ORDER, companyId: COMPANY }) },
    movimientoInventario: {
      findMany: vi.fn().mockResolvedValue([{ tipo: 'INGRESO', cantidad: 10, costoUnitario: 100 }]),
      create: vi.fn(),
    },
    $transaction: vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
  };
  return tx;
}

describe('InventarioService — caminos de falla antes de persistir', () => {
  it('rechaza una salida que deja stock negativo', async () => {
    const db = database();
    await expect(new InventarioService(db as never).registrar(USER, COMPANY, {
      articuloId: ARTICLE, tipo: 'SALIDA', cantidad: 11, fecha: '2026-09-25', ordenId: ORDER,
      periodoImputado: '2026-09-01', documento: 'Vale 19',
    }, actor)).rejects.toMatchObject({ statusCode: 422, code: 'STOCK_INSUFICIENTE' });
    expect(db.movimientoInventario.create).not.toHaveBeenCalled();
  });

  it('rechaza una salida sin ordenId', async () => {
    const db = database();
    await expect(new InventarioService(db as never).registrar(USER, COMPANY, {
      articuloId: ARTICLE, tipo: 'SALIDA', cantidad: 1, fecha: '2026-09-25',
      periodoImputado: '2026-09-01', documento: 'Vale sin orden',
    }, actor)).rejects.toMatchObject({ statusCode: 422 });
  });

  it('responde 404 para un artículo de otra empresa', async () => {
    const db = database('55555555-5555-4555-8555-555555555555');
    await expect(new InventarioService(db as never).registrar(USER, COMPANY, {
      articuloId: ARTICLE, tipo: 'INGRESO', cantidad: 1, costoUnitario: 100,
      fecha: '2026-09-25', periodoImputado: '2026-09-01', documento: 'Compra ajena',
    }, actor)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('PERIODO usa el promedio ponderado de los ingresos del período', async () => {
    const db = database(COMPANY, 'PERIODO');
    db.movimientoInventario.findMany.mockResolvedValue([
      { tipo: 'INGRESO', cantidad: 100, costoUnitario: 1000, periodoImputado: new Date('2026-09-01') },
      { tipo: 'INGRESO', cantidad: 60, costoUnitario: 1300, periodoImputado: new Date('2026-09-01') },
    ]);
    db.movimientoInventario.create.mockImplementation(({ data }) => Promise.resolve({ id: ARTICLE, ...data }));
    (db as typeof db & { traceAuditLog: { create: ReturnType<typeof vi.fn> } }).traceAuditLog = { create: vi.fn() };
    const result = await new InventarioService(db as never).registrar(USER, COMPANY, {
      articuloId: ARTICLE, tipo: 'SALIDA', cantidad: 30, fecha: '2026-09-25', ordenId: ORDER,
      periodoImputado: '2026-09-01', documento: 'Vale período',
    }, actor);
    expect(Number(result.costoUnitario)).toBe(1112.5);
  });
});
