import { describe, it, expect, vi } from 'vitest';
import { classifyDocument } from '../../src/infrastructure/classifier/cascade-classifier.js';
// La memoria de correcciones va a la base y su fallo es no-fatal, pero cuesta
// ~4s de timeout por llamada en una máquina sin Docker. Sin base ya devolvía
// `undefined`: mockearla no cambia lo que se prueba, solo saca la espera.
// El detalle está en tests/classifier/cascade-section-decision.test.ts.
vi.mock('@/infrastructure/classifier/memory/correction-memory.js', () => ({
  getCorrectionExamples: vi.fn(async () => undefined),
}));


// `classifyDocument` llega a la API de Groq y una llamada normal tarda ~4,9s,
// justo en el borde del timeout por defecto de 5000ms. Cuando la cuota del free
// tier aprieta, estos tests fallan por TIEMPO y no por comportamiento. Ver la
// nota extendida en waste-intent.test.ts.
vi.setConfig({ testTimeout: 30_000 });

const BASE = { costistId: 'c-001', companyId: 'co-001', dataEntryId: 'de-001' };

describe('classifyDocument — conflicto entre capas (cero errores silenciosos)', () => {
  it('NO auto-clasifica cuando una señal definitiva choca con corroborantes fuertes de otro tipo', async () => {
    // Señal definitiva FACTURA_ABC (→ FACTURA_COMPRA) PERO el texto está lleno de
    // señales fuertes de liquidación (ANSES + OBRA SOCIAL + JUBILACIÓN ≥ 30 pts).
    // Antes: cortocircuitaba en FACTURA y devolvía sin revisión. Ahora: conflicto → revisión.
    const text = `
      FACTURA A
      ANSES OBRA SOCIAL JUBILACION
      Aportes y contribuciones del personal
    `;
    const result = await classifyDocument({ ...BASE, text, groqQuality: 'legible' });
    // Groq no está configurado en tests → sin desempate de IA → debe ir a revisión humana.
    expect(result.requiresReview).toBe(true);
  });

  it('SÍ auto-clasifica un recibo de sueldo aunque mencione el CUIT del empleador (ruido débil, no conflicto)', async () => {
    // El puesto está declarado a propósito: lo que este test mide es que el CUIT
    // del empleador no genere un conflicto de TIPO de documento (recibo vs
    // factura). Sin puesto, el documento escalaría por la corrección CL-02 y el
    // test dejaría de medir lo que dice medir.
    const text = `
      RECIBO DE SUELDO
      Empleado: María González — operaria de línea  CUIL 27-28765432-1
      CUIT empleador: 30-11111111-2
      OBRA SOCIAL: OSDE   ANSES
      SUELDO BÁSICO
    `;
    const result = await classifyDocument({ ...BASE, text, groqQuality: 'legible' });
    expect(result.documentType).toBe('LIQUIDACION_MOD');
    expect(result.costSection).toBe('MANO_DE_OBRA');
    expect(result.requiresReview).toBe(false);
    expect(result.aiUsed).toBe(false);
  });
});
