import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ModulosRubroService } from '@/application/operacion/modulos-rubro-service.js';
import { CATEGORIA_AVICOLA_POSTURA, PAQUETE_AVICOLA_POSTURA } from '@/application/operacion/paquete-avicola.js';
import { withTenant } from '@/infrastructure/database/prisma.js';
import { withTenantContext } from '@/infrastructure/database/tenant-context.js';
import { createTenant, disconnect, type Tenant } from './helpers/tenants.js';

let A: Tenant;
let B: Tenant;
const actor = { role: 'COSTISTA', area: 'costista', method: 'manual' };

beforeAll(async () => {
  A = await createTenant('modulos-a');
  B = await createTenant('modulos-b');
  await Promise.all([A, B].map((tenant) => withTenant(tenant.userId, (tx) =>
    tx.company.update({ where: { id: tenant.companyId }, data: { industry: 'AVICULTURA' } }),
  )));
  const paquete = await withTenant(A.userId, (tx) => tx.paqueteRubro.findFirst({
    where: { category: CATEGORIA_AVICOLA_POSTURA, userId: null, companyId: null, structureId: null, periodId: null },
  }));
  if (!paquete) {
    await withTenant(A.userId, (tx) => tx.paqueteRubro.create({
      data: { category: CATEGORIA_AVICOLA_POSTURA, userId: null, companyId: null, structureId: null, periodId: null, ...PAQUETE_AVICOLA_POSTURA },
    }));
  }
});

afterAll(disconnect);

describe('A-17 — configuración de módulos aislada por empresa', () => {
  it('un estado de A no se filtra a B mediante RLS', async () => {
    const service = new ModulosRubroService();
    await withTenantContext(A.userId, () => service.set(A.userId, A.companyId, 'variantes', true, { id: A.userId, ...actor }));

    const deA = await withTenantContext(A.userId, () => service.listar(A.userId, A.companyId));
    const deB = await withTenantContext(B.userId, () => service.listar(B.userId, B.companyId));
    expect(deA.find((modulo) => modulo.clave === 'variantes')?.estado).toBe('prendido');
    expect(deB.find((modulo) => modulo.clave === 'variantes')?.estado).toBe('apagado');

    const filasAjena = await withTenant(B.userId, (tx) => tx.configuracionModuloRubro.findMany({ where: { companyId: A.companyId } }));
    expect(filasAjena).toEqual([]);
  });

  it('apagar un módulo conserva su configuración para que pueda reactivarse', async () => {
    const service = new ModulosRubroService();
    await withTenantContext(A.userId, () => service.set(A.userId, A.companyId, 'alimento', true, { id: A.userId, ...actor }));
    await withTenantContext(A.userId, () => service.set(A.userId, A.companyId, 'alimento', false, { id: A.userId, ...actor }));
    const fila = await withTenant(A.userId, (tx) => tx.configuracionModuloRubro.findUnique({
      where: { companyId_moduleId: { companyId: A.companyId, moduleId: 'alimento' } },
    }));
    expect(fila).toMatchObject({ activo: false });
    expect(await withTenant(A.userId, (tx) => tx.configuracionModuloRubro.count({
      where: { companyId: A.companyId, moduleId: 'alimento' },
    }))).toBe(1);
  });
});
