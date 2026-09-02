import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DepositoService } from '@/application/operacion/deposito-service.js';
import { withTenant } from '@/infrastructure/database/prisma.js';
import { createTenant, disconnect, type Tenant } from './helpers/tenants.js';

let A: Tenant; let B: Tenant; let depositoId: string;
const actor = (t: Tenant) => ({ id: t.userId, role: 'COSTISTA', area: 'costista', method: 'manual' });
beforeAll(async () => {
  A = await createTenant('deposito-a'); B = await createTenant('deposito-b');
  const unidad = await withTenant(A.userId, (tx) => tx.unidadMedida.create({ data: { companyId: A.companyId, userId: A.userId, codigo: 'u_deposito', nombre: 'Unidad de depósito' } }));
  depositoId = (await new DepositoService().create(A.userId, A.companyId, { referencia: 'deposito_a', capacidad: 40, unidadId: unidad.id, umbralBajo: 8 }, actor(A))).id;
});
afterAll(disconnect);
describe('A-12 — depósito con nivel derivado', () => {
  it('deriva nivel y alerta por umbral físico, sin columna de nivel editable', async () => {
    const service = new DepositoService();
    await service.movimiento(A.userId, depositoId, { tipo: 'ingreso', cantidad: 20, fecha: '2026-09-02' }, actor(A));
    await service.movimiento(A.userId, depositoId, { tipo: 'egreso', cantidad: 14, fecha: '2026-09-02' }, actor(A));
    expect(await service.nivel(A.userId, depositoId)).toMatchObject({ nivel: 6, umbralBajo: 8, alertaNivelBajo: true });
    await expect(withTenant(A.userId, (tx) => tx.deposito.create({ data: { companyId: A.companyId, userId: A.userId, referencia: 'manual', capacidad: 1, unidadId: ('' as string), umbralBajo: 0,
      // @ts-expect-error El nivel no se persiste.
      nivel: 1 } }))).rejects.toThrow(/nivel/);
  });
  it('rechaza un egreso que vuelve negativo el nivel y RLS oculta depósitos ajenos', async () => {
    const service = new DepositoService();
    await expect(service.movimiento(A.userId, depositoId, { tipo: 'egreso', cantidad: 7, fecha: '2026-09-02' }, actor(A))).rejects.toThrow(/debajo de cero/);
    expect(await withTenant(B.userId, (tx) => tx.deposito.findMany({ where: { companyId: A.companyId } }))).toEqual([]);
  });
});
