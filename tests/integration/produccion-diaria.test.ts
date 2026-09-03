import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProduccionDiariaService } from '@/application/operacion/produccion-diaria-service.js';
import { withTenant } from '@/infrastructure/database/prisma.js';
import { createTenant, disconnect, type Tenant } from './helpers/tenants.js';

let A: Tenant;
let B: Tenant;
let loteA1: string;
let loteA2: string;
let loteSinAves: string;
const FECHA = '2026-09-02';

const actor = (tenant: Tenant) => ({ id: tenant.userId, role: 'COSTISTA', area: 'costista', method: 'manual' });

async function lote(tenant: Tenant, referencia: string) {
  return withTenant(tenant.userId, (tx) =>
    tx.loteProductivo.create({ data: { companyId: tenant.companyId, userId: tenant.userId, referencia } }),
  );
}
async function alta(tenant: Tenant, loteId: string, cantidad: number) {
  return withTenant(tenant.userId, (tx) => tx.eventoLote.create({
    data: { companyId: tenant.companyId, userId: tenant.userId, loteId, tipo: 'ALTA', cantidad, fecha: new Date(`${FECHA}T00:00:00.000Z`) },
  }));
}

beforeAll(async () => {
  A = await createTenant('produccion-a');
  B = await createTenant('produccion-b');
  loteA1 = (await lote(A, 'lote_produccion_a_1')).id;
  loteA2 = (await lote(A, 'lote_produccion_a_2')).id;
  loteSinAves = (await lote(A, 'lote_produccion_sin_aves')).id;
  await alta(A, loteA1, 10);
  await alta(A, loteA2, 30);
});

afterAll(disconnect);

describe('A-11 — producción diaria e indicadores de postura', () => {
  it('expone postura por lote y de plantel con denominadores distintos', async () => {
    const service = new ProduccionDiariaService();
    await service.create(A.userId, loteA1, {
      fecha: FECHA, variante: 'variante_a', unidadesProducidas: 9, roturas: 1, descartes: 0,
    }, actor(A));
    await service.create(A.userId, loteA2, {
      fecha: FECHA, variante: 'variante_b', unidadesProducidas: 15, roturas: 0, descartes: 0,
    }, actor(A));

    const indicadores = await service.indicadores(A.userId, loteA1, FECHA);
    expect(indicadores.posturaPorLote).toBeCloseTo(0.9);
    expect(indicadores.posturaDePlantel).toBeCloseTo(0.6);
    expect(indicadores.posturaPorLote).not.toBe(indicadores.posturaDePlantel);
  });

  it('reporta inconsistencia y no divide por cero si hay producción sin aves vivas', async () => {
    const service = new ProduccionDiariaService();
    await service.create(A.userId, loteSinAves, {
      fecha: FECHA, variante: 'variante_c', unidadesProducidas: 3, roturas: 0, descartes: 0,
    }, actor(A));
    const indicadores = await service.indicadores(A.userId, loteSinAves, FECHA);
    expect(indicadores.posturaPorLote).toBeNull();
    expect(indicadores.inconsistencia).toMatchObject({ code: 'PRODUCCION_SIN_ANIMALES_VIVOS' });
  });

  it('no permite persistir postura manual y RLS oculta la producción de otra empresa', async () => {
    await expect(withTenant(A.userId, (tx) => tx.produccionDiaria.create({
      data: {
        companyId: A.companyId, userId: A.userId, loteId: loteA1, fecha: new Date(`${FECHA}T00:00:00.000Z`),
        variante: 'variante_manual', unidadesProducidas: 1,
        // @ts-expect-error La postura se deriva y no existe como columna.
        posturaPorLote: 0.9,
      },
    }))).rejects.toThrow(/posturaPorLote/);
    const ajena = await withTenant(B.userId, (tx) =>
      tx.produccionDiaria.findMany({ where: { companyId: A.companyId } }),
    );
    expect(ajena).toEqual([]);
  });
});
