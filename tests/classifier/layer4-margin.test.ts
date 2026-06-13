import { describe, it, expect } from 'vitest';
import { runLayer4, SECTION_MARGIN } from '../../src/infrastructure/classifier/layers/layer4-business-routing.js';

describe('runLayer4 — cost-section margin', () => {
  it('routes confidently when one section clearly leads', () => {
    // 3 keywords MP, 0 CIP → MATERIA_PRIMA sin IA
    const r = runLayer4('FACTURA_COMPRA', 'compra de carne pollo y queso', 'GASTRONOMIA');
    expect(r.costSection).toBe('MATERIA_PRIMA');
    expect(r.requiresAI).toBe(false);
  });

  it('requires AI when the lead between two sections is too narrow', () => {
    // 2 MP (carne, pollo) vs 1 CIP (limpieza) → margen de 1 keyword → ambiguo
    const r = runLayer4('FACTURA_COMPRA', 'carne pollo y productos de limpieza', 'GASTRONOMIA');
    expect(r.requiresAI).toBe(true);
  });

  it('requires AI on an exact tie between sections', () => {
    // 1 MP (carne) vs 1 CIP (seguro) → empate → ambiguo
    const r = runLayer4('FACTURA_COMPRA', 'carne y seguro del local', 'GASTRONOMIA');
    expect(r.requiresAI).toBe(true);
  });

  it('keeps SECTION_MARGIN exported and positive', () => {
    expect(SECTION_MARGIN).toBeGreaterThan(0);
  });
});
