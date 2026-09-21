import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '@/infrastructure/database/prisma.js';
import { createTenant, disconnect, type Tenant } from './helpers/tenants.js';

let A: Tenant;
let B: Tenant;
let entryId: string;

beforeAll(async () => {
  A = await createTenant('classifier-cost-a');
  B = await createTenant('classifier-cost-b');
  entryId = await withTenant(A.userId, async (tx) => {
    const connection = await tx.empresaConnection.create({
      data: { companyId: A.companyId, costistId: A.userId },
    });
    const entry = await tx.dataEntry.create({
      data: { connectionId: connection.id, costistId: A.userId, rawContent: 'contenido no persistido en métricas' },
    });
    await tx.classifierAiCall.create({
      data: {
        dataEntryId: entry.id, companyId: A.companyId, costistId: A.userId,
        provider: 'groq', model: 'modelo-test', inputTokens: 120, outputTokens: 30,
        latencyMs: 18, estimatedCost: 0.00015, costCurrency: 'USD',
      },
    });
    return entry.id;
  });
});

afterAll(disconnect);

describe('classifier_ai_calls — persistencia y RLS real', () => {
  it('guarda métricas vinculadas a la carga sin guardar su contenido', async () => {
    const rows = await withTenant(A.userId, (tx) => tx.classifierAiCall.findMany({ where: { dataEntryId: entryId } }));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      provider: 'groq', model: 'modelo-test', inputTokens: 120, outputTokens: 30, latencyMs: 18,
    });
    expect(rows[0]).not.toHaveProperty('rawContent');
  });

  it('un tenant no puede leer las métricas de otro', async () => {
    const rows = await withTenant(B.userId, (tx) => tx.classifierAiCall.findMany({ where: { dataEntryId: entryId } }));
    expect(rows).toEqual([]);
  });
});
