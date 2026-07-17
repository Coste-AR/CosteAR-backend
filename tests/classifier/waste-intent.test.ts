import { describe, it, expect } from 'vitest';
import {
  classifyWaste,
  detectIntent,
} from '@/infrastructure/classifier/layers/layer0a-intent-detection.js';
import { classifyDocument } from '@/infrastructure/classifier/cascade-classifier.js';

const BASE_INPUT = { costistId: 'c-001', companyId: 'co-001', dataEntryId: 'de-001' };

// ─────────────────────────────────────────────────────────────────────────────
// Eje normal/extraordinario a nivel de la función pura classifyWaste.
// Es una clasificación general, desacoplada del método de costeo.
// ─────────────────────────────────────────────────────────────────────────────
describe('classifyWaste — naturaleza de la merma', () => {
  it('siniestro (incendio) → EXTRAORDINARY sin necesitar calificador', () => {
    expect(classifyWaste('Se incendió el depósito y se quemó la mercadería')?.nature)
      .toBe('EXTRAORDINARY');
  });

  it('robo → EXTRAORDINARY', () => {
    expect(classifyWaste('Nos robaron el stock del galpón')?.nature).toBe('EXTRAORDINARY');
  });

  it('inundación → EXTRAORDINARY', () => {
    expect(classifyWaste('El depósito quedó anegado por la inundación')?.nature)
      .toBe('EXTRAORDINARY');
  });

  it('"se pudrió todo" (deterioro total) → EXTRAORDINARY', () => {
    expect(classifyWaste('Se cortó la luz y se pudrió toda la carne')?.nature)
      .toBe('EXTRAORDINARY');
  });

  it('calificador "merma extraordinaria" → EXTRAORDINARY', () => {
    expect(classifyWaste('Registramos una merma extraordinaria este mes')?.nature)
      .toBe('EXTRAORDINARY');
  });

  it('"merma de proceso dentro de lo normal" → NORMAL', () => {
    expect(classifyWaste('La merma de proceso estuvo dentro de lo normal')?.nature)
      .toBe('NORMAL');
  });

  it('"% habitual" → NORMAL', () => {
    expect(classifyWaste('El desperdicio fue el porcentaje habitual de siempre')?.nature)
      .toBe('NORMAL');
  });

  it('"scrap de proceso" → NORMAL', () => {
    expect(classifyWaste('Generamos el scrap de proceso de siempre')?.nature).toBe('NORMAL');
  });

  it('merma genérica sin naturaleza declarada → AMBIGUOUS', () => {
    expect(classifyWaste('Tuvimos una merma de 30 kg esta semana')?.nature).toBe('AMBIGUOUS');
  });

  it('señales contradictorias (extraordinaria + normal, sin siniestro) → AMBIGUOUS', () => {
    expect(classifyWaste('Fue una merma anormal pero dentro de lo normal')?.nature)
      .toBe('AMBIGUOUS');
  });

  it('un siniestro manda aunque el texto diga "normal" → EXTRAORDINARY', () => {
    // Un incendio no es rutina: el evento duro tiene precedencia.
    expect(classifyWaste('Hubo un incendio, la merma fue mayor a lo normal')?.nature)
      .toBe('EXTRAORDINARY');
  });

  it('texto sin lenguaje de merma → null (el eje no aplica)', () => {
    expect(classifyWaste('Llegó la factura de luz por $50000')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Wiring en detectIntent: cómo la naturaleza afecta el intent.
// ─────────────────────────────────────────────────────────────────────────────
describe('detectIntent — merma normal vs extraordinaria', () => {
  it('(a) lenguaje extraordinario claro → PERDIDA_INVENTARIO', () => {
    const r = detectIntent('Se incendió el galpón y se quemó todo el stock de materia prima');
    expect(r.intent).toBe('PERDIDA_INVENTARIO');
    expect(r.wasteNature).toBe('EXTRAORDINARY');
  });

  it('(b) merma normal → NO dispara PERDIDA_INVENTARIO ni revisión', () => {
    const r = detectIntent('La merma de proceso de esta semana estuvo dentro de lo normal');
    expect(r.intent).not.toBe('PERDIDA_INVENTARIO');
    expect(r.wasteNature).toBe('NORMAL');
    expect(r.requiresReview).toBeUndefined();
  });

  it('(c) merma ambigua → revisión obligatoria, sin auto-clasificar como pérdida', () => {
    const r = detectIntent('Tuvimos una merma de 40 kg de harina esta semana');
    expect(r.intent).not.toBe('PERDIDA_INVENTARIO');
    expect(r.wasteNature).toBe('AMBIGUOUS');
    expect(r.requiresReview).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Wiring end-to-end en la cascada: el ruteo real de la sección de costos.
// ─────────────────────────────────────────────────────────────────────────────
describe('classifyDocument — ruteo de merma en la cascada', () => {
  it('(a) merma extraordinaria → intent PERDIDA_INVENTARIO', async () => {
    const text = 'Se incendió el depósito anoche y se quemó toda la mercadería de materia prima.';
    const result = await classifyDocument({ ...BASE_INPUT, text, groqQuality: 'legible' });
    expect(result.intent).toBe('PERDIDA_INVENTARIO');
  });

  it('(b) merma normal en una factura de MP → sigue la cascada y cae en MATERIA_PRIMA', async () => {
    const text = `
      FACTURA A
      CAE Nº: 75123456789012
      CUIT: 20-10000000-9
      PUNTO DE VENTA 0001
      Fecha: 10/06/2026
      Proveedor: Molinos SA
      Harina 000 — 1000 kg
      Nota: la merma de proceso estuvo dentro de lo normal.
    `;
    const result = await classifyDocument({ ...BASE_INPUT, text, groqQuality: 'legible' });
    // No se etiqueta como pérdida: se costea como cualquier otro documento.
    expect(result.intent).not.toBe('PERDIDA_INVENTARIO');
    expect(result.documentType).toBe('FACTURA_COMPRA');
    expect(result.costSection).toBe('MATERIA_PRIMA');
    expect(result.requiresReview).toBe(false);
  });

  it('(c) merma ambigua → revisión obligatoria, no se clasifica como pérdida', async () => {
    const text = 'Tuvimos una merma de 30 kg de materia prima esta semana en el galpón.';
    const result = await classifyDocument({ ...BASE_INPUT, text, groqQuality: 'legible' });
    expect(result.requiresReview).toBe(true);
    expect(result.intent).not.toBe('PERDIDA_INVENTARIO');
    expect(result.costSection).not.toBe('VENTAS');
  });

  it('(d) regresión: robo (extraordinario) sigue clasificando como PERDIDA_INVENTARIO', async () => {
    const text = 'Nos robaron toda la mercadería del depósito anoche.';
    const result = await classifyDocument({ ...BASE_INPUT, text, groqQuality: 'legible' });
    expect(result.intent).toBe('PERDIDA_INVENTARIO');
  });
});
