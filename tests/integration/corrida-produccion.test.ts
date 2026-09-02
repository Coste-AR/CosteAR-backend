import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CorridaProduccionService } from '@/application/operacion/corrida-produccion-service.js';
import { withTenant } from '@/infrastructure/database/prisma.js';
import { createTenant, disconnect, type Tenant } from './helpers/tenants.js';

let A: Tenant; let B: Tenant; let corridaId: string;
const actor = (t: Tenant) => ({ id: t.userId, role: 'COSTISTA', area: 'costista', method: 'manual' });
beforeAll(async () => {
  A = await createTenant('corrida-a'); B = await createTenant('corrida-b');
  corridaId = (await new CorridaProduccionService().create(A.userId, A.companyId, { referencia: 'corrida_a', formula: 'formula_base', kilosReales: 10, destino: 'propia' }, actor(A))).id;
});
afterAll(disconnect);
describe('A-13 — corrida y costo por kilo derivado', () => {
  it('sin consumos informa incompleta y con PPP deriva costo por kilo', async () => {
    const service = new CorridaProduccionService();
    expect(await service.resultado(A.userId, corridaId)).toEqual({ costoPorKilo: null, incompleta: true });
    await service.consumo(A.userId, corridaId, { material: 'insumo_a', cantidad: 2, costoUnitarioPpp: 3 }, actor(A));
    await service.consumo(A.userId, corridaId, { material: 'insumo_b', cantidad: 1, costoUnitarioPpp: 4 }, actor(A));
    expect(await service.resultado(A.userId, corridaId)).toMatchObject({ costoPorKilo: 1, incompleta: false });
  });
  it('no acepta costo por kilo manual y RLS oculta la corrida ajena', async () => {
    await expect(withTenant(A.userId, (tx) => tx.corridaProduccion.create({ data: { companyId: A.companyId, userId: A.userId, referencia: 'manual', formula: 'x', kilosReales: 1, destino: 'PROPIA',
      // @ts-expect-error El costo por kilo es derivado.
      costoPorKilo: 99 } }))).rejects.toThrow(/costoPorKilo/);
    expect(await withTenant(B.userId, (tx) => tx.corridaProduccion.findMany({ where: { companyId: A.companyId } }))).toEqual([]);
  });
});
