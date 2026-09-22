import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '@/infrastructure/database/prisma.js';
import { createTenant, disconnect, type Tenant } from './helpers/tenants.js';

let A: Tenant;
let B: Tenant;

beforeAll(async () => {
  A = await createTenant('preferencias-a');
  B = await createTenant('preferencias-b');
});

afterAll(disconnect);

describe('A-18 — preferencias aisladas por usuario', () => {
  it('RLS impide que B lea la preferencia de A', async () => {
    await withTenant(A.userId, (tx) => tx.userPreference.create({
      data: {
        userId: A.userId,
        preferences: { home: { accesosRapidos: ['carga.produccion-diaria'] } },
      },
    }));

    expect(await withTenant(A.userId, (tx) => tx.userPreference.findUnique({ where: { userId: A.userId } })))
      .toMatchObject({ userId: A.userId });
    expect(await withTenant(B.userId, (tx) => tx.userPreference.findUnique({ where: { userId: A.userId } })))
      .toBeNull();
  });
});
