import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OrdenTrabajoService } from '@/application/ordenes/orden-trabajo-service.js';
import { withTenant } from '@/infrastructure/database/prisma.js';
import { createTenant, disconnect, type Tenant } from './helpers/tenants.js';

let A: Tenant;
let B: Tenant;
const actor = (userId: string) => ({ id: userId, role: 'EMPRESA_ADMIN', area: 'costista', method: 'manual' });

beforeAll(async () => { A = await createTenant('orden-a'); B = await createTenant('orden-b'); });
afterAll(disconnect);

describe('FX-OT — orden de trabajo con RLS real', () => {
  it('recorre el ciclo hasta pendiente de cierre y audita cada paso', async () => {
    const service = new OrdenTrabajoService();
    const order = await service.create(A.userId, A.companyId, {
      codigo: 'OT-001', descripcion: 'Obra X', cliente: 'Cliente ficticio', plantillaId: null, fechaInicio: '2026-09-25',
    }, actor(A.userId));
    for (const estado of ['COTIZADA', 'APROBADA', 'EN_PRODUCCION', 'TERMINADA_TECNICA', 'PENDIENTE_CIERRE'] as const) {
      await service.transition(A.userId, order.id, { estado }, actor(A.userId));
    }
    expect((await service.get(A.userId, order.id)).estado).toBe('PENDIENTE_CIERRE');
    expect(await withTenant(A.userId, (tx) => tx.traceAuditLog.count({ where: { entityType: 'OrdenTrabajo', entityId: order.id } }))).toBe(6);
    await expect(service.get(B.userId, order.id)).rejects.toMatchObject({ statusCode: 404 });
    expect(await withTenant(B.userId, (tx) => tx.ordenTrabajo.findMany({ where: { id: order.id } }))).toEqual([]);
  });

  it('limita el código a la empresa', async () => {
    const service = new OrdenTrabajoService();
    await expect(service.create(A.userId, A.companyId, {
      codigo: 'OT-001', descripcion: 'Duplicada', cliente: 'Cliente ficticio', plantillaId: null, fechaInicio: null,
    }, actor(A.userId))).rejects.toMatchObject({ statusCode: 409 });
    await expect(service.create(B.userId, B.companyId, {
      codigo: 'OT-001', descripcion: 'Otra empresa', cliente: 'Cliente ficticio', plantillaId: null, fechaInicio: null,
    }, actor(B.userId))).resolves.toMatchObject({ codigo: 'OT-001' });
  });
});
