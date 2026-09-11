import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import {
  CATEGORY,
  EXTERNAL_IDS_RETIRADOS,
  seedVocabularioAvicola,
  terminos,
  validarVocabularioPublico,
} from '../../prisma/seed-vocabulario-avicola.js';

describe('seed de vocabulario público', () => {
  it('deja solo los 61 términos de rubro', () => {
    expect(terminos).toHaveLength(61);
    const presentes = new Set(terminos.map((termino) => termino.externalId));

    expect(EXTERNAL_IDS_RETIRADOS.filter((externalId) => presentes.has(externalId))).toEqual([]);
  });

  it('rechaza un identificador protegido si vuelve a entrar al seed', () => {
    const identificadorProtegido = 'dato-tenant-de-prueba';
    const huellaProtegida = new Set([
      'd716b4e82e6b73946c063c343d23ca6fb7f9381c9cc4cb21a0690cab495420f0',
    ]);

    expect(() => validarVocabularioPublico([
      { ...terminos[0], termino: identificadorProtegido },
    ], huellaProtegida)).toThrow('identificador de tenant retirado');
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
