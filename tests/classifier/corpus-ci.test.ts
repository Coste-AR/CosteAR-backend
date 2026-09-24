import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type { CostSection } from '@/infrastructure/classifier/types.js';

vi.mock('@/infrastructure/classifier/memory/correction-memory.js', () => ({
  getCorrectionExamples: vi.fn(async () => undefined),
}));

vi.mock('@/infrastructure/classifier/layers/layer5-ai-fallback.js', () => ({
  runLayer5: vi.fn(async ({ text }: { text: string }) => {
    if (text.includes('Veterinaria responsable')) {
      return { documentType: 'LIQUIDACION_MOD', costSection: 'COSTOS_INDIRECTOS', confidence: 88, reasoning: 'La veterinaria es mano de obra indirecta.' };
    }
    if (text.includes('Ramiro Quiroga')) {
      return { documentType: 'LIQUIDACION_MOD', costSection: 'DESCONOCIDO', confidence: 40, reasoning: 'El puesto no está declarado.' };
    }
    if (text.includes('Capataz de galpones')) {
      return { documentType: 'LIQUIDACION_MOD', costSection: 'COSTOS_INDIRECTOS', confidence: 88, reasoning: 'El capataz es mano de obra indirecta.' };
    }
    if (text.includes('LIQUIDACIÓN DE GASTOS DEL ESTABLECIMIENTO')) {
      return { documentType: 'FACTURA_COMPRA', costSection: 'MULTIPLE', confidence: 88, reasoning: 'El documento contiene varias secciones.' };
    }
    return null;
  }),
}));

interface CorpusCase {
  id: string;
  expected: CostSection;
  text: string;
  esperaEscalamiento?: boolean;
}

const corpusPath = fileURLToPath(new URL('../../corpus-clasificador/corpus.json', import.meta.url));
const cases = (JSON.parse(readFileSync(corpusPath, 'utf8')) as { casos: CorpusCase[] }).casos;
const { classifyDocument } = await import('@/infrastructure/classifier/cascade-classifier.js');

describe('corpus del clasificador en CI', () => {
  it.each(cases.map((c) => [c.id, c.expected, c] as const))(
    '%s → %s',
    async (_id, expected, corpusCase) => {
      const result = await classifyDocument({
        costistId: '00000000-0000-4000-8000-000000000011',
        companyId: '00000000-0000-4000-8000-000000000012',
        dataEntryId: '00000000-0000-4000-8000-000000000013',
        text: corpusCase.text,
        industry: 'Establecimiento avícola de postura',
        groqQuality: 'legible',
      });

      expect(result.costSection).toBe(expected);
      if (corpusCase.esperaEscalamiento) expect(result.requiresReview).toBe(true);
    },
  );
});
