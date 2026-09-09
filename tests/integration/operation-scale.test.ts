import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CompanyService } from '@/application/companies/company-service.js';
import { withTenant } from '@/infrastructure/database/prisma.js';
import { createTenant, disconnect, type Tenant } from './helpers/tenants.js';

const audit = { ipAddress: '127.0.0.1', userAgent: 'test' };
const SCALE = { value: 1200, unit: 'unidades_fisicas_por_anio' };

let tenant: Tenant;

beforeAll(async () => {
  tenant = await createTenant('operation-scale');
});

afterAll(disconnect);

describe('Escala física declarada por empresa', () => {
  it('una empresa sin escala conserva null, sin completar un valor por defecto', async () => {
    const company = await withTenant(tenant.userId, (tx) =>
      new CompanyService(tx as never).getById(tenant.userId, tenant.companyId),
    );

    expect(company.operationScaleValue).toBeNull();
    expect(company.operationScaleUnit).toBeNull();
  });

  it('persiste valor y unidad física como una única declaración', async () => {
    await withTenant(tenant.userId, (tx) =>
      new CompanyService(tx as never).update(tenant.userId, tenant.companyId, { operationScale: SCALE }, audit),
    );
    const company = await withTenant(tenant.userId, (tx) =>
      new CompanyService(tx as never).getById(tenant.userId, tenant.companyId),
    );

    expect(company.operationScaleValue?.toString()).toBe('1200');
    expect(company.operationScaleUnit).toBe(SCALE.unit);
  });
});
