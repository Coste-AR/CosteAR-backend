import { describe, expect, it, vi } from 'vitest';

vi.mock('@/infrastructure/classifier/memory/correction-memory.js', () => ({
  getCorrectionExamples: vi.fn(async () => undefined),
}));

const { classifyDocument } = await import('@/infrastructure/classifier/cascade-classifier.js');
const { getScaleCalibrationWarning, MATERIAL_SCALE_FACTOR } = await import('@/infrastructure/classifier/profile-scale.js');

const base = {
  text: `
    FACTURA A
    CAE Nº: 75123456789012
    CUIT: 20-10000000-9
    PUNTO DE VENTA 0001
    Proveedor: Insumos de prueba SRL
    Material de prueba para producción
  `,
  costistId: 'costist-test', companyId: 'company-test', dataEntryId: 'entry-test',
  industry: 'manufactura', groqQuality: 'legible' as const,
};

function decision(result: Awaited<ReturnType<typeof classifyDocument>>) {
  return {
    documentType: result.documentType,
    costSection: result.costSection,
    confidence: result.confidence,
    requiresReview: result.requiresReview,
  };
}

describe('señal de calibración de escala', () => {
  it('mantiene una clasificación dentro del rango sin una señal nueva', async () => {
    const withoutScale = await classifyDocument(base);
    const withinRange = await classifyDocument({
      ...base,
      operationScale: { value: 250, unit: 'unidades_fisicas_por_anio' },
      profileScale: { value: 100, unit: 'unidades_fisicas_por_anio' },
    });

    expect(decision(withinRange)).toEqual(decision(withoutScale));
    expect(withinRange.scaleCalibrationWarning).toBeUndefined();
  });

  it('con una diferencia material conserva la clasificación y expone la señal', async () => {
    const withoutScale = await classifyDocument(base);
    const outsideRange = await classifyDocument({
      ...base,
      operationScale: { value: 500, unit: 'unidades_fisicas_por_anio' },
      profileScale: { value: 100, unit: 'unidades_fisicas_por_anio' },
    });

    expect(decision(outsideRange)).toEqual(decision(withoutScale));
    expect(outsideRange.confidence).toBeGreaterThanOrEqual(72);
    expect(outsideRange.scaleCalibrationWarning).toEqual({
      code: 'OUTSIDE_CALIBRATED_RANGE',
      operationScale: { value: 500, unit: 'unidades_fisicas_por_anio' },
      profileScale: { value: 100, unit: 'unidades_fisicas_por_anio' },
      materialFactor: 5,
    });
  });

  it('sin escala declarada conserva exactamente el comportamiento anterior', async () => {
    const result = await classifyDocument({
      ...base,
      profileScale: { value: 100, unit: 'unidades_fisicas_por_anio' },
    });

    expect(result.scaleCalibrationWarning).toBeUndefined();
  });

  it('señala unidades no comparables en vez de inventar una conversión', () => {
    expect(getScaleCalibrationWarning(
      { value: 100, unit: 'unidades_fisicas_por_anio' },
      { value: 100, unit: 'cajas_por_anio' },
    )).toMatchObject({ code: 'UNIT_MISMATCH' });
    expect(MATERIAL_SCALE_FACTOR).toBe(3);
  });
});
