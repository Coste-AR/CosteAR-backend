import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { VentaProductoService } from '@/application/operacion/venta-producto-service.js';
import { withTenant } from '@/infrastructure/database/prisma.js';
import { createTenant, disconnect, type Tenant } from './helpers/tenants.js';

let A: Tenant; let B: Tenant; let unidadA: string; let unidadB: string;
const actor = (tenant: Tenant) => ({ id: tenant.userId, role: 'COSTISTA', area: 'costista', method: 'manual' });

async function unidad(tenant: Tenant, codigo: string) {
  const base = await withTenant(tenant.userId, (tx) => tx.unidadMedida.create({
    data: { companyId: tenant.companyId, userId: tenant.userId, codigo: `${codigo}_base`, nombre: 'Unidad base de prueba' },
  }));
  return withTenant(tenant.userId, (tx) => tx.unidadMedida.create({
    data: { companyId: tenant.companyId, userId: tenant.userId, codigo, nombre: 'Unidad de venta de prueba', baseId: base.id, factor: 10 },
  }));
}

beforeAll(async () => {
  A = await createTenant('ventas-a'); B = await createTenant('ventas-b');
  unidadA = (await unidad(A, 'venta_a')).id;
  unidadB = (await unidad(B, 'venta_b')).id;
});
afterAll(disconnect);

describe('A-15 — ventas por canal y precio promedio derivado', () => {
  it('deriva el promedio ponderado general y por canal en la unidad solicitada', async () => {
    const service = new VentaProductoService();
    await service.create(A.userId, A.structureId, { fecha: '2026-08-10', canal: 'directo', variante: 'variante_prueba', cantidad: 2, precioUnitario: 8, unidadId: unidadA }, actor(A));
    await service.create(A.userId, A.structureId, { fecha: '2026-08-12', canal: 'mayorista', variante: 'variante_prueba', cantidad: 1, precioUnitario: 14, unidadId: unidadA }, actor(A));

    const promedio = await service.precioPromedio(A.userId, A.periodId, unidadA);
    expect(promedio.general).toMatchObject({ precioPromedio: 10, cantidad: 3, sinVentas: false });
    expect(promedio.porCanal).toEqual(expect.arrayContaining([
      expect.objectContaining({ canal: 'directo', precioPromedio: 8 }),
      expect.objectContaining({ canal: 'mayorista', precioPromedio: 14 }),
    ]));
  });

  it('sin ventas devuelve ausencia de dato, no cero, y el promedio no se puede escribir', async () => {
    const service = new VentaProductoService();
    await expect(withTenant(A.userId, (tx) => tx.ventaProducto.create({ data: {
      companyId: A.companyId, userId: A.userId, structureId: A.structureId, fecha: new Date('2026-08-13'), canal: 'directo', variante: 'manual', cantidad: 1, precioUnitario: 1, unidadId: unidadA,
      // @ts-expect-error El promedio es derivado; no existe columna para escribirlo.
      precioPromedio: 1,
    } }))).rejects.toThrow(/precioPromedio/);
    expect((await service.precioPromedio(B.userId, B.periodId, unidadB)).general).toMatchObject({ precioPromedio: null, sinVentas: true });
  });

  it('RLS no permite leer ventas de otra empresa', async () => {
    expect(await withTenant(B.userId, (tx) => tx.ventaProducto.findMany({ where: { companyId: A.companyId } }))).toEqual([]);
  });
});
