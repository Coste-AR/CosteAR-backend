import { beforeAll, describe, expect, it } from 'vitest';
import { TelemetriaPanelService } from '@/application/telemetria/telemetria-panel-service.js';
import { withTenantContext } from '@/infrastructure/database/tenant-context.js';
import { withTenant } from '@/infrastructure/database/prisma.js';
import { createTenant, db, type Tenant } from './helpers/tenants.js';

let tenantA: Tenant;
let tenantB: Tenant;

beforeAll(async () => {
  tenantA = await createTenant('telemetria-a');
  tenantB = await createTenant('telemetria-b');
});

describe('telemetría del panel — persistencia y RLS real', () => {
  it('persiste sin identidad del actor y otro tenant no puede leer el evento', async () => {
    const service = new TelemetriaPanelService(db);
    const saved = await withTenantContext(tenantA.userId, () => service.registrar(
      tenantA.companyId,
      { id: tenantA.userId, role: 'COSTISTA' },
      { tipo: 'CARGA_INICIADA', accion: 'carga.produccion-diaria' },
    ));

    const visibleA = await withTenant(tenantA.userId, (tx) =>
      tx.panelTelemetryEvent.findUnique({ where: { id: saved.id } }));
    const visibleB = await withTenant(tenantB.userId, (tx) =>
      tx.panelTelemetryEvent.findUnique({ where: { id: saved.id } }));

    expect(visibleA).toMatchObject({
      companyId: tenantA.companyId,
      userId: tenantA.userId,
      technicalRole: 'COSTISTA',
    });
    expect(visibleA).not.toHaveProperty('actorId');
    expect(visibleB).toBeNull();
  });
});
