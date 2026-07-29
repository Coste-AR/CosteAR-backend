import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { classifyDocument } from '@/infrastructure/classifier/cascade-classifier.js';
import { resetEnvCache } from '@/infrastructure/config/env.js';

const { groqFetchMock } = vi.hoisted(() => ({ groqFetchMock: vi.fn() }));

vi.mock('@/infrastructure/ai/groq-rate-limiter.js', () => ({
  groqFetch: groqFetchMock,
}));

const BASE_INPUT = { costistId: 'c-001', companyId: 'co-001', dataEntryId: 'de-001' };

describe('classifyDocument — cascade orchestrator', () => {
  it('classifies a factura with CAE at ≥95 confidence without AI', async () => {
    const text = `
      FACTURA A
      CAE Nº: 75123456789012
      CUIT: 20-10000000-9
      PUNTO DE VENTA 0001
      Fecha: 10/06/2026
      Proveedor: Aceros SRL
      Bobina de acero AISI 1020 — 500 kg
    `;
    const result = await classifyDocument({ ...BASE_INPUT, text, groqQuality: 'legible' });
    expect(result.documentType).toBe('FACTURA_COMPRA');
    expect(result.costSection).toBe('MATERIA_PRIMA');
    expect(result.confidence).toBeGreaterThanOrEqual(95);
    expect(result.requiresReview).toBe(false);
    expect(result.aiUsed).toBe(false);
  });

  it('classifies a liquidación at ≥95 confidence without AI', async () => {
    const text = `
      RECIBO DE SUELDO
      Empleado: María González  CUIL 27-28765432-1
      OBRA SOCIAL: OSDE  ANSES: Sí
      SUELDO BÁSICO
      Fecha: 01/06/2026
    `;
    const result = await classifyDocument({ ...BASE_INPUT, text, groqQuality: 'legible' });
    expect(result.documentType).toBe('LIQUIDACION_MOD');
    expect(result.costSection).toBe('MANO_DE_OBRA');
    expect(result.confidence).toBeGreaterThanOrEqual(95);
    expect(result.aiUsed).toBe(false);
  });

  it('returns FAIL gate for ilegible quality', async () => {
    const result = await classifyDocument({ ...BASE_INPUT, text: '', groqQuality: 'ilegible' });
    expect(result.qualityGate).toBe('FAIL');
    expect(result.requiresReview).toBe(true);
    expect(result.documentType).toBe('DESCONOCIDO');
  });

  // Estos tres tests SÍ llegan a la Capa 5 (IA), así que necesitan Groq
  // "configurado" y mockeado — a diferencia de los de arriba, que resuelven
  // por reglas deterministas y nunca llaman a Groq.
  describe('con Groq configurado (mockeado, sin red real)', () => {
    const ORIGINAL_KEY = process.env.GROQ_API_KEY;

    beforeAll(() => {
      process.env.GROQ_API_KEY = 'gsk_test_key_1234567890';
      resetEnvCache();
    });

    afterAll(() => {
      process.env.GROQ_API_KEY = ORIGINAL_KEY;
      resetEnvCache();
    });

    function mockGroqReply(reply: Record<string, unknown>) {
      groqFetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: JSON.stringify(reply) } }] }),
        text: async () => '',
      });
    }

    it('caps confidence at 65 for partial quality even if Groq reports higher confidence', async () => {
      mockGroqReply({
        documentType: 'FACTURA_COMPRA',
        costSection: 'MATERIA_PRIMA',
        confidence: 95,
        reasoning: 'Confianza alta reportada por el modelo (mock de test).',
      });

      const text = 'FACTURA A CUIT 20-10000000-9 CAE Nº: 75123456789012';
      const result = await classifyDocument({ ...BASE_INPUT, text, groqQuality: 'parcial' });

      expect(result.aiUsed).toBe(true);
      expect(result.qualityGate).toBe('PARTIAL');
      // El cap por calidad parcial (65) manda por sobre lo que diga la IA (95).
      expect(result.confidence).toBeLessThanOrEqual(65);
    });
  });
});
