import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import {
  CATEGORY,
  EXTERNAL_IDS_RETIRADOS,
  seedVocabularioAvicola,
  terminos,
} from '../../prisma/seed-vocabulario-avicola.js';

describe('seed de vocabulario público', () => {
  it('deja solo los 61 términos de rubro', () => {
    expect(terminos).toHaveLength(61);
    const presentes = new Set(terminos.map((termino) => termino.externalId));

    expect(EXTERNAL_IDS_RETIRADOS.filter((externalId) => presentes.has(externalId))).toEqual([]);
  });

  it('retira las filas heredadas antes de upsertear y conserva la reejecución idempotente', async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 0 });
    const upsert = vi.fn().mockResolvedValue({});
    const db = { vocabularioTermino: { deleteMany, upsert } } as unknown as PrismaClient;

    await seedVocabularioAvicola(db);
    await seedVocabularioAvicola(db);

    expect(deleteMany).toHaveBeenCalledTimes(2);
    expect(deleteMany).toHaveBeenCalledWith({
      where: { industryCategory: CATEGORY, externalId: { in: [...EXTERNAL_IDS_RETIRADOS] } },
    });
    expect(upsert).toHaveBeenCalledTimes(terminos.length * 2);
  });
});
