import { describe, it, expect, vi } from 'vitest';
import { classifyDocument } from '@/infrastructure/classifier/cascade-classifier.js';

const { groqFetchMock } = vi.hoisted(() => ({ groqFetchMock: vi.fn() }));

vi.mock('@/infrastructure/ai/groq-rate-limiter.js', () => ({
  groqFetch: groqFetchMock,
}));

// Mismo patrón que groq-costista-chat.test.ts / groq-usage-logging.test.ts:
// mockear getEnv() directamente (en vez de mutar process.env + resetEnvCache)
// para no depender de en qué orden corren los tests dentro del archivo ni de
// estado global compartido con otros archivos — eso fue justo lo que hizo
// flaquear este test en CI (pasaba siempre local, falló en GitHub Actions
// porque GroqClient ya había cacheado la key placeholder antes de que
// process.env.GROQ_API_KEY se actualizara).
vi.mock('@/infrastructure/config/env.js', () => ({
  getEnv: () => ({ GROQ_API_KEY: 'gsk_test_key_1234567890' }),
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

  it('classifies a liquidación WITH a production role at ≥95 confidence without AI', async () => {
    // El camino rápido determinista: cuando el puesto SÍ se reconoce como mano de
    // obra directa, la cascada resuelve sin IA y con confianza alta.
    const text = `
      RECIBO DE SUELDO
      Empleado: María González — operaria de línea de producción
      CUIL 27-28765432-1
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

  it('does NOT assert Mano de Obra Directa for a liquidación with no job title (CL-02)', async () => {
    // Este caso ANTES afirmaba MANO_DE_OBRA con confianza ≥95 y sin IA: era el
    // bug CL-02 (dos de los siete errores de alta confianza de la auditoría del
    // 06/08/2026 salían de acá). "Empleado: María González" da un nombre, no un
    // puesto, así que no hay forma de saber si esa persona transforma la materia
    // prima — y la regla de la cátedra (Clase 1) hace depender MOD exactamente
    // de eso.
    //
    // El tipo de documento se sigue reconociendo bien: lo que cambia es que la
    // SECCIÓN deja de afirmarse.
    const text = `
      RECIBO DE SUELDO
      Empleado: María González  CUIL 27-28765432-1
      OBRA SOCIAL: OSDE  ANSES: Sí
      SUELDO BÁSICO
      Fecha: 01/06/2026
    `;
    const result = await classifyDocument({ ...BASE_INPUT, text, groqQuality: 'legible' });
    expect(result.documentType).toBe('LIQUIDACION_MOD');
    expect(
      result.costSection === 'MANO_DE_OBRA' && result.confidence >= 95 && !result.requiresReview,
      'un recibo sin puesto volvió a imputarse a mano de obra directa con confianza alta',
    ).toBe(false);
  });

  it('returns FAIL gate for ilegible quality', async () => {
    const result = await classifyDocument({ ...BASE_INPUT, text: '', groqQuality: 'ilegible' });
    expect(result.qualityGate).toBe('FAIL');
    expect(result.requiresReview).toBe(true);
    expect(result.documentType).toBe('DESCONOCIDO');
  });

  // Este test SÍ llega a la Capa 5 (IA) — a diferencia de los de arriba, que
  // resuelven por reglas deterministas y nunca llaman a Groq. GROQ_API_KEY
  // ya está mockeada como "configurada" arriba (vi.mock de env.js) para todo
  // el archivo; acá solo falta mockear la respuesta del fetch.
  describe('con Groq configurado (mockeado, sin red real)', () => {
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
