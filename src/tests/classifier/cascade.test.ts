import { describe, it, expect } from 'vitest';
import { classifyDocument } from '../../infrastructure/classifier/cascade-classifier.js';

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

  // This test would call Groq AI (parcial quality caps confidence at 65 < 72 threshold).
  // Skip if GROQ_API_KEY is not configured in the environment.
  it.skip('caps confidence at 65 for partial quality even with strong signals', async () => {
    const text = 'FACTURA A CUIT 20-10000000-9 CAE Nº: 75123456789012';
    const result = await classifyDocument({ ...BASE_INPUT, text, groqQuality: 'parcial' });
    expect(result.confidence).toBeLessThanOrEqual(65);
    expect(result.qualityGate).toBe('PARTIAL');
  });
});
