import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PaqueteRubroService } from '@/application/operacion/paquete-rubro-service.js';
import { withTenant } from '@/infrastructure/database/prisma.js';
import { createTenant, disconnect, type Tenant } from './helpers/tenants.js';

let A: Tenant;
let B: Tenant;

beforeAll(async () => {
  A = await createTenant('paquete-a');
  B = await createTenant('paquete-b');
  await withTenant(A.userId, (tx) => tx.paqueteRubro.create({
    data: {
      category: 'TEST', userId: null, companyId: null, structureId: null, periodId: null,
      lexicon: { UnidadProductiva: 'Rubro' }, icons: {}, variants: [], seedParameters: {}, alertRules: {}, screens: {},
    },
  }));
  await withTenant(A.userId, (tx) => tx.paqueteRubro.create({
    data: {
      category: 'TEST', userId: A.userId, companyId: A.companyId, structureId: null, periodId: null,
      lexicon: { UnidadProductiva: 'Empresa' }, icons: {}, variants: [], seedParameters: {}, alertRules: {}, screens: {},
    },
  }));
});

afterAll(disconnect);

describe('A-16 — paquete de rubro y cascada', () => {
  it('resuelve empresa sobre rubro y devuelve defaults para clave ausente', async () => {
    const service = new PaqueteRubroService();
    const resolved = await service.resolve(A.userId, 'TEST', { companyId: A.companyId });
    expect((resolved.lexicon as Record<string, string>).UnidadProductiva).toBe('Empresa');
    const fallback = await service.resolve(A.userId, 'MISSING');
    expect(fallback.defaults['lexicon.UnidadProductiva']).toBe('Unidad productiva');
  });

  it('aísla los paquetes por usuario mediante RLS', async () => {
    const rows = await withTenant(B.userId, (tx) => tx.paqueteRubro.findMany({ where: { userId: A.userId } }));
    expect(rows).toEqual([]);
  });
});
