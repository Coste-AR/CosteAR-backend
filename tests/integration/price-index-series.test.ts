import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PriceIndexSeriesService } from '@/application/parametros/price-index-series-service.js';
import { withTenantContext } from '@/infrastructure/database/tenant-context.js';
import { withTenant } from '@/infrastructure/database/prisma.js';
import { createTenant, disconnect, db, type Tenant } from './helpers/tenants.js';

const actor = (userId: string) => ({ id: userId, role: 'EMPRESA_ADMIN', area: 'costista', method: 'manual' }) as const;
let A: Tenant;
let B: Tenant;

beforeAll(async () => {
  A = await createTenant('price-index-a');
  B = await createTenant('price-index-b');
});
afterAll(disconnect);

describe('M11-01 — serie de índices versionada y aislada', () => {
  it('corregir un período crea una versión completa nueva sin alterar la anterior', async () => {
    const service = new PriceIndexSeriesService(db);
    const first = await withTenantContext(A.userId, () => service.save(A.userId, A.companyId, {
      source: 'IPC manual', basePeriodCode: '2026-01',
      values: [{ periodCode: '2026-01', indexValue: 100 }, { periodCode: '2026-07', indexValue: 150 }],
    }, actor(A.userId)));
    const second = await withTenantContext(A.userId, () => service.save(A.userId, A.companyId, {
      source: 'IPC manual', basePeriodCode: '2026-01',
      values: [{ periodCode: '2026-07', indexValue: 151 }],
    }, actor(A.userId)));

    expect(first.version.number).toBe(1);
    expect(second.version.number).toBe(2);
    expect(second.values).toEqual([
      { periodCode: '2026-01', indexValue: 100 },
      { periodCode: '2026-07', indexValue: 151 },
    ]);

    const versions = await withTenant(A.userId, (tx) => tx.priceIndexSeriesVersion.findMany({
      where: { companyId: A.companyId }, include: { values: true }, orderBy: { version: 'asc' },
    }));
    expect(versions).toHaveLength(2);
    expect(Number(versions[0]!.values.find((v) => v.periodCode === '2026-07')!.indexValue)).toBe(150);

    const historicalValue = versions[0]!.values.find((v) => v.periodCode === '2026-07')!;
    await expect(withTenant(A.userId, (tx) => tx.priceIndexValue.update({
      where: { id: historicalValue.id }, data: { indexValue: 999 },
    }))).rejects.toThrow(/append-only/i);
  });

  it('RLS y la propiedad de empresa impiden leer la serie de otro tenant', async () => {
    const service = new PriceIndexSeriesService(db);
    await expect(withTenantContext(B.userId, () => service.get(B.userId, A.companyId)))
      .rejects.toThrow(/negocio no encontrado/i);
  });
});
