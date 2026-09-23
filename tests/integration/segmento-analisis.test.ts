import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SegmentoAnalisisService } from '@/application/parametros/segmento-analisis-service.js';
import { withTenantContext } from '@/infrastructure/database/tenant-context.js';
import { createTenant, disconnect, db, type Tenant } from './helpers/tenants.js';

const actor = (userId: string) => ({ id: userId, role: 'EMPRESA_ADMIN', area: 'costista', method: 'manual' }) as const;
let A: Tenant;
let B: Tenant;

beforeAll(async () => {
  A = await createTenant('segmentos-a');
  B = await createTenant('segmentos-b');
});
afterAll(disconnect);

describe('SegmentoAnalisis con RLS real', () => {
  it('crea una jerarquía, calcula AM-02 y aísla empresas', async () => {
    const service = new SegmentoAnalisisService(db);
    const datos = [
      { nombre: 'A', participacion: 0.2, precioUnitario: 100, costoVariableUnitario: 60, costoFijoDirecto: 20_000, prorrateoIndirectos: 2_400 },
      { nombre: 'B', participacion: 0.3, precioUnitario: 60, costoVariableUnitario: 40, costoFijoDirecto: 6_000, prorrateoIndirectos: 3_600 },
      { nombre: 'C', participacion: 0.5, precioUnitario: 40, costoVariableUnitario: 28, costoFijoDirecto: 2_000, prorrateoIndirectos: 6_000 },
    ];
    for (const fila of datos) {
      await withTenantContext(A.userId, () => service.crear(A.userId, A.companyId, {
        ...fila, nivel: 'linea', parentId: null, produccionConjunta: false, coproductos: [],
      }, actor(A.userId)));
    }
    const resultado = await withTenantContext(A.userId, () => service.calcular(A.userId, A.companyId));
    expect(resultado.equilibrioGeneral).toBe(2_000);
    expect(resultado.controlIndirectos.diferencia).toBe(0);
    const vistoPorB = await withTenantContext(B.userId, () => service.listar(B.userId, B.companyId));
    expect(vistoPorB).toEqual([]);
    await expect(withTenantContext(B.userId, () => service.listar(B.userId, A.companyId)))
      .rejects.toThrow(/negocio no encontrado/i);
  });
});
