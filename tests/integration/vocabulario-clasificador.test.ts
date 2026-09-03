import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/infrastructure/database/prisma.js';

vi.mock('@/infrastructure/classifier/layers/layer5-ai-fallback.js', () => ({
  runLayer5: vi.fn(async () => null),
}));

vi.mock('@/infrastructure/classifier/memory/correction-memory.js', () => ({
  getCorrectionExamples: vi.fn(async () => undefined),
}));

const { classifyDocument } = await import('@/infrastructure/classifier/cascade-classifier.js');

const suffix = randomUUID();
const termino = `insumo-prueba-${suffix}`;
const variante = `variante-prueba-${suffix}`;

const input = (industry: string) => ({
  costistId: randomUUID(),
  companyId: randomUUID(),
  dataEntryId: randomUUID(),
  industry,
  groqQuality: 'legible' as const,
  text: `FACTURA A\nCAE N°: 75123456789012\nDetalle: ${variante}`,
});

beforeAll(async () => {
  await prisma.vocabularioTermino.create({
    data: {
      industryCategory: 'AVICULTURA',
      termino,
      variantes: [variante],
      concepto: 'Término sintético para verificar la conexión del vocabulario.',
      entidadDominio: 'Prueba de integración',
      seccion: 'MATERIA_PRIMA',
    },
  });
});

afterAll(async () => {
  await prisma.vocabularioTermino.deleteMany({ where: { termino } });
});

describe('VocabularioTermino en el cascade del clasificador', () => {
  it('clasifica una variante que existe solo en la tabla del rubro', async () => {
    const result = await classifyDocument(input('Avicultura de postura'));

    expect(result.documentType).toBe('FACTURA_COMPRA');
    expect(result.costSection).toBe('MATERIA_PRIMA');
    expect(result.requiresReview).toBe(false);
  });

  it('deja de clasificar por ese término si se desactiva en la tabla', async () => {
    await prisma.vocabularioTermino.update({
      where: { industryCategory_termino: { industryCategory: 'AVICULTURA', termino } },
      data: { isActive: false },
    });

    const result = await classifyDocument(input('Avicultura de postura'));

    expect(result.costSection).toBe('DESCONOCIDO');
    expect(result.requiresReview).toBe(true);
  });

  it('no aplica el vocabulario avícola a una empresa de otro rubro', async () => {
    await prisma.vocabularioTermino.update({
      where: { industryCategory_termino: { industryCategory: 'AVICULTURA', termino } },
      data: { isActive: true },
    });

    const result = await classifyDocument(input('Manufactura'));

    expect(result.industryCategory).toBe('MANUFACTURA');
    expect(result.costSection).toBe('DESCONOCIDO');
    expect(result.requiresReview).toBe(true);
  });
});
