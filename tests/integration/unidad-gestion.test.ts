import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CompanyService } from '@/application/companies/company-service.js';
import { NotFoundError } from '@/domain/errors/domain-error.js';
import { withTenant } from '@/infrastructure/database/prisma.js';
import { createTenant, disconnect, type Tenant } from './helpers/tenants.js';

const audit = { ipAddress: '127.0.0.1', userAgent: 'test' };

let A: Tenant;
let B: Tenant;
let unidadAId: string;
let unidadBId: string;

beforeAll(async () => {
  A = await createTenant('unidad-gestion-a');
  B = await createTenant('unidad-gestion-b');

  unidadAId = (await withTenant(A.userId, (tx) =>
    tx.unidadMedida.create({
      data: { companyId: A.companyId, userId: A.userId, codigo: 'cajon_a', nombre: 'Cajón A' },
    }),
  )).id;
  unidadBId = (await withTenant(B.userId, (tx) =>
    tx.unidadMedida.create({
      data: { companyId: B.companyId, userId: B.userId, codigo: 'cajon_b', nombre: 'Cajón B' },
    }),
  )).id;
});

afterAll(disconnect);

describe('Unidad de gestión declarada por empresa', () => {
  it('una empresa sin declaración responde null explícito, sin inferir el perfil de rubro', async () => {
    const company = await withTenant(A.userId, (tx) =>
      new CompanyService(tx as never).getById(A.userId, A.companyId),
    );

    expect(company).toHaveProperty('unidadGestionId', null);
  });

  it('conserva la unidad que la empresa declaró explícitamente', async () => {
    const updated = await withTenant(A.userId, (tx) =>
      new CompanyService(tx as never).update(A.userId, A.companyId, { unidadGestionId: unidadAId }, audit),
    );

    expect(updated.unidadGestionId).toBe(unidadAId);
    const fetched = await withTenant(A.userId, (tx) =>
      new CompanyService(tx as never).getById(A.userId, A.companyId),
    );
    expect(fetched.unidadGestionId).toBe(unidadAId);
  });

  it('rechaza la unidad de otra empresa bajo el rol restringido de la aplicación', async () => {
    await expect(withTenant(A.userId, (tx) =>
      new CompanyService(tx as never).update(A.userId, A.companyId, { unidadGestionId: unidadBId }, audit),
    )).rejects.toThrow(NotFoundError);
  });

  it('Postgres restringe borrar la unidad que la empresa declaró usar', async () => {
    await expect(withTenant(A.userId, (tx) =>
      tx.unidadMedida.delete({ where: { id: unidadAId } }),
    )).rejects.toMatchObject({ code: 'P2003' });
  });
});
