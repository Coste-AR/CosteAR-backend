import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProduccionDiariaService } from '@/application/operacion/produccion-diaria-service.js';
import { StockProductoService } from '@/application/operacion/stock-producto-service.js';
import { withTenant } from '@/infrastructure/database/prisma.js';
import { createTenant, disconnect, type Tenant } from './helpers/tenants.js';

let A: Tenant;
let B: Tenant;
let loteId: string;
let partidaRecienteId: string;
const actor = (tenant: Tenant) => ({ id: tenant.userId, role: 'COSTISTA', area: 'costista', method: 'manual' });

beforeAll(async () => {
  A = await createTenant('stock-producto-a');
  B = await createTenant('stock-producto-b');
  loteId = (await withTenant(A.userId, (tx) => tx.loteProductivo.create({
    data: { companyId: A.companyId, userId: A.userId, referencia: 'lote_stock_producto' },
  }))).id;
  const produccion = new ProduccionDiariaService();
  await produccion.create(A.userId, loteId, {
    fecha: '2026-08-20', variante: 'variante_stock', unidadesProducidas: 10, roturas: 1, descartes: 1,
  }, actor(A));
  partidaRecienteId = (await produccion.create(A.userId, loteId, {
    fecha: '2026-09-01', variante: 'variante_stock', unidadesProducidas: 8, roturas: 0, descartes: 0,
  }, actor(A))).id;
});

afterAll(disconnect);

describe('A-14 — stock de producto terminado por variante y partida', () => {
  it('deriva saldo y edad por partida, con un límite de vida útil parametrizado', async () => {
    const stock = await new StockProductoService().stock(A.userId, A.companyId, '2026-09-04');
    expect(stock).toMatchObject({
      vidaUtilDias: 7,
      vidaUtilOrigen: 'default',
      vidaUtilConfirmada: false,
      porVariante: [{ variante: 'variante_stock', unidadesDisponibles: 16 }],
    });
    expect(stock.partidas).toEqual(expect.arrayContaining([
      expect.objectContaining({ unidadesDisponibles: 8, diasDeVida: 15, vencida: true }),
      expect.objectContaining({ partidaId: partidaRecienteId, unidadesDisponibles: 8, diasDeVida: 3, vencida: false }),
    ]));
  });

  it('no permite escribir un saldo manual ni registrar un egreso mayor al disponible', async () => {
    const service = new StockProductoService();
    await expect(withTenant(A.userId, (tx) => tx.produccionDiaria.create({
      data: {
        companyId: A.companyId, userId: A.userId, loteId, fecha: new Date('2026-09-03T00:00:00.000Z'),
        variante: 'variante_manual', unidadesProducidas: 1,
        // @ts-expect-error El stock se deriva; no existe una columna editable.
        stockProducto: 1,
      },
    }))).rejects.toThrow(/stockProducto/);
    await expect(service.egresar(A.userId, partidaRecienteId, {
      cantidad: 9, fecha: '2026-09-04',
    }, actor(A))).rejects.toThrow(/supera el stock disponible/);
    await service.egresar(A.userId, partidaRecienteId, { cantidad: 3, fecha: '2026-09-04' }, actor(A));
    const saldo = await service.stock(A.userId, A.companyId, '2026-09-04');
    expect(saldo.porVariante).toEqual([{ variante: 'variante_stock', unidadesDisponibles: 13 }]);
  });

  it('RLS impide consultar el stock de otra empresa', async () => {
    await expect(new StockProductoService().stock(B.userId, A.companyId, '2026-09-04'))
      .rejects.toThrow(/Empresa no encontrada/);
  });
});
