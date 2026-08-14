/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CL-03 — la sección guardada y la explicación mostrada son UNA sola decisión
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * El defecto medido (GA-05, auditoría del 06/08/2026): cuando Layer 4 pisaba la
 * sección de la IA, el sistema guardaba `MANO_DE_OBRA` pero al costista le seguía
 * mostrando la explicación de la IA — *"…lo que indica un gasto de
 * comercialización"*. La justificación defendía una decisión que el sistema no
 * tomó.
 *
 * Este archivo **construye el desacuerdo explícitamente**: mockea Layer 5 para
 * que la IA responda una sección concreta y arma el texto para que Layer 4 rutee
 * a otra distinta con `requiresAI:false` (la condición exacta del pisado). El
 * corpus NO puede probar esto: su caso GA-05 es una factura de proveedor por
 * comisiones y no dispara el ruteo de liquidación (ver ground-truth.md).
 *
 * Lo que se asserta es el estado inválido, no el caso puntual: **jamás puede
 * guardarse una sección mientras se muestra la justificación de otra.**
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { CostSection, DocumentType } from '@/infrastructure/classifier/types.js';
import type { Layer5Result } from '@/infrastructure/classifier/layers/layer5-ai-fallback.js';
import type { Layer4Result } from '@/infrastructure/classifier/layers/layer4-business-routing.js';

// La IA es la única pieza no determinista de la cascada. Se mockea para poder
// construir el desacuerdo a voluntad — y para no depender de la cuota de Groq.
const h = vi.hoisted(() => ({ ai: null as Layer5Result | null }));

vi.mock('@/infrastructure/classifier/layers/layer5-ai-fallback.js', () => ({
  runLayer5: vi.fn(async () => h.ai),
}));

const { classifyDocument, resolveSectionAfterAI } =
  await import('@/infrastructure/classifier/cascade-classifier.js');
const { runLayer4 } = await import('@/infrastructure/classifier/layers/layer4-business-routing.js');

/** Corre el Layer 4 real: documenta la premisa de cada test en vez de asumirla. */
const runLayer4Real = (documentType: DocumentType): Layer4Result =>
  runLayer4(documentType, TEXTO_SIN_SENALES, 'DEFAULT', ROL_DIRECTO);

const BASE = {
  costistId:   '00000000-0000-4000-8000-0000000000c3',
  companyId:   '00000000-0000-4000-8000-0000000000c4',
  dataEntryId: '00000000-0000-4000-8000-0000000000c5',
};

/**
 * Texto sin señales deterministas: garantiza que la cascada NO cortocircuite en
 * la vía rápida y llegue a Layer 5. El puesto viaja por `extractedData.role`,
 * que es lo que hace que Layer 4 rutee la liquidación con `requiresAI:false`.
 */
const TEXTO_SIN_SENALES = 'Detalle del período 07/2026. Total: $ 1.250.000.';

const ROL_DIRECTO = 'operario de línea';

function ia(costSection: CostSection, reasoning: string, documentType: DocumentType = 'LIQUIDACION_MOD'): Layer5Result {
  return { documentType, costSection, confidence: 97, reasoning };
}

const clasificar = () => classifyDocument({
  ...BASE,
  text: TEXTO_SIN_SENALES,
  extractedData: { role: ROL_DIRECTO },
  groqQuality: 'legible',
});

beforeEach(() => { h.ai = null; });

describe('CL-03 — desacuerdo entre Layer 4 y la IA', () => {

  it('el caso testigo GA-05: la explicación de la IA nunca justifica una sección que el sistema no guardó', async () => {
    // La IA lee el documento como comisiones de vendedor…
    const razonIA = 'El concepto liquidado son comisiones sobre ventas del mes, lo que indica un gasto de comercialización';
    h.ai = ia('GASTO_COMERCIALIZACION', razonIA);

    // …y Layer 4, sobre el MISMO tipo de documento que eligió la IA, rutea a
    // MANO_DE_OBRA con requiresAI:false. Ése es el pisado que producía el híbrido.
    const l4 = runLayer4Real('LIQUIDACION_MOD');
    expect(l4.costSection).toBe('MANO_DE_OBRA');
    expect(l4.requiresAI).toBe(false);

    const r = await clasificar();

    // ── El híbrido no puede ocurrir ──────────────────────────────────────────
    // Antes: costSection = MANO_DE_OBRA + explicación diciendo "gasto de
    // comercialización". Ahora la sección guardada es la que la explicación
    // defiende.
    expect(r.aiUsed).toBe(true);
    expect(r.costSection).toBe('GASTO_COMERCIALIZACION');
    expect(r.explanation).toContain(razonIA);

    // La discrepancia no se esconde: se declara, con las dos lecturas a la vista.
    expect(r.explanation).toContain('Mano de Obra Directa');
    expect(r.explanation).toContain('NO coincide');

    // Y el documento no se aplica solo: lo confirma el costista.
    expect(r.requiresReview).toBe(true);
    expect(r.explanation).toContain('Las reglas y la IA no coinciden');
  });

  it('en TODO desacuerdo, la sección guardada es la que la explicación mostrada justifica', async () => {
    const casos: Array<{ seccionIA: CostSection; razon: string }> = [
      { seccionIA: 'GASTO_COMERCIALIZACION', razon: 'RAZON-A: comisiones de venta, es un gasto de comercialización' },
      { seccionIA: 'GASTO_ADMINISTRACION',   razon: 'RAZON-B: sueldo del área administrativa, fuera de producción' },
      { seccionIA: 'COSTOS_INDIRECTOS',      razon: 'RAZON-C: mano de obra indirecta de planta' },
      { seccionIA: 'MULTIPLE',               razon: 'RAZON-D: el documento tiene conceptos de tres secciones distintas' },
      { seccionIA: 'DESCONOCIDO',            razon: 'RAZON-E: no alcanza la información para imputar' },
    ];

    for (const c of casos) {
      h.ai = ia(c.seccionIA, c.razon);
      const r = await clasificar();

      // Layer 4 dice MANO_DE_OBRA en los cinco; la IA dice otra cosa en los cinco.
      expect(r.costSection, `${c.seccionIA}: la sección guardada no es la de la explicación`)
        .toBe(c.seccionIA);
      expect(r.explanation, `${c.seccionIA}: no se muestra la justificación de lo guardado`)
        .toContain(c.razon);
      expect(r.requiresReview, `${c.seccionIA}: un desacuerdo no puede aplicarse solo`).toBe(true);
    }
  });

  it('MULTIPLE sobrevive: Layer 4 no puede colapsar a una sección un documento que la IA leyó como mixto', async () => {
    h.ai = ia('MULTIPLE', 'El recibo tiene horas de producción, horas de supervisión y viáticos administrativos');
    const r = await clasificar();
    expect(r.costSection).toBe('MULTIPLE');
  });

  // ── Contracara: no inflar la revisión ─────────────────────────────────────
  // La auditoría ya midió que 4 de 6 revisiones son sobre documentos bien
  // clasificados. La revisión forzada tiene que dispararse SOLO en el desacuerdo
  // real, nunca cuando las dos fuentes dicen lo mismo.

  it('cuando Layer 4 y la IA coinciden, no se agrega ninguna revisión ni ninguna advertencia', async () => {
    const razonIA = 'Recibo de haberes de un operario de línea de producción';
    h.ai = ia('MANO_DE_OBRA', razonIA);

    const r = await clasificar();

    expect(r.costSection).toBe('MANO_DE_OBRA');
    expect(r.explanation).toContain(razonIA);
    expect(r.explanation).not.toContain('NO coincide');
    expect(r.requiresReview).toBe(false);   // confianza 97 ≥ 72 y sin desacuerdo
  });

  it('cuando Layer 4 no tiene regla determinista, no hay desacuerdo que declarar', async () => {
    // FACTURA_COMPRA sobre un texto sin keywords → Layer 4 devuelve requiresAI:true,
    // o sea que no tiene autoridad para contradecir a nadie.
    const l4 = runLayer4Real('FACTURA_COMPRA');
    expect(l4.requiresAI).toBe(true);

    const razonIA = 'Factura de compra de servicios de comercialización';
    h.ai = ia('GASTO_COMERCIALIZACION', razonIA, 'FACTURA_COMPRA');

    const r = await clasificar();

    expect(r.costSection).toBe('GASTO_COMERCIALIZACION');
    expect(r.explanation).toContain(razonIA);
    expect(r.explanation).not.toContain('NO coincide');
    expect(r.requiresReview).toBe(false);
  });
});

describe('CL-03 — resolveSectionAfterAI: los cuatro cuadrantes', () => {
  const l4 = (costSection: CostSection, requiresAI: boolean): Layer4Result => ({
    costSection, requiresAI, confidence: requiresAI ? 50 : 99, reasoning: `REGLA-${costSection}`,
  });
  const iaResp = { costSection: 'GASTO_COMERCIALIZACION' as CostSection, reasoning: 'RAZON-IA' };

  it('coinciden y Layer 4 es determinista → decide la IA, sin disenso', () => {
    const d = resolveSectionAfterAI(iaResp, l4('GASTO_COMERCIALIZACION', false));
    expect(d).toMatchObject({ section: 'GASTO_COMERCIALIZACION', reasoning: 'RAZON-IA', ruleDissent: false });
  });

  it('coinciden y Layer 4 pide IA → decide la IA, sin disenso', () => {
    const d = resolveSectionAfterAI(iaResp, l4('GASTO_COMERCIALIZACION', true));
    expect(d).toMatchObject({ section: 'GASTO_COMERCIALIZACION', reasoning: 'RAZON-IA', ruleDissent: false });
  });

  it('difieren pero Layer 4 pide IA → decide la IA, sin disenso (Layer 4 no afirma nada)', () => {
    const d = resolveSectionAfterAI(iaResp, l4('MANO_DE_OBRA', true));
    expect(d).toMatchObject({ section: 'GASTO_COMERCIALIZACION', reasoning: 'RAZON-IA', ruleDissent: false });
  });

  it('difieren y Layer 4 es determinista → decide la IA, con disenso declarado en el mismo texto', () => {
    const d = resolveSectionAfterAI(iaResp, l4('MANO_DE_OBRA', false));
    expect(d.section).toBe('GASTO_COMERCIALIZACION');
    expect(d.ruleDissent).toBe(true);
    expect(d.reasoning).toContain('RAZON-IA');       // lo que sostiene la sección guardada
    expect(d.reasoning).toContain('REGLA-MANO_DE_OBRA'); // la lectura descartada, citada como tal
    expect(d.reasoning).toContain('Mano de Obra Directa');
  });

  it('la sección de la decisión NUNCA es la de Layer 4 cuando difieren', () => {
    const secciones: CostSection[] = [
      'MATERIA_PRIMA', 'MANO_DE_OBRA', 'COSTOS_INDIRECTOS', 'VENTAS',
      'GASTO_COMERCIALIZACION', 'GASTO_ADMINISTRACION', 'GASTO_FINANCIERO',
      'MULTIPLE', 'DESCONOCIDO',
    ];
    for (const secIA of secciones) {
      for (const secL4 of secciones) {
        for (const requiresAI of [true, false]) {
          const d = resolveSectionAfterAI({ costSection: secIA, reasoning: 'RAZON-IA' }, l4(secL4, requiresAI));
          // Invariante única: la sección resuelta es siempre la de la IA, y su
          // justificación siempre contiene la de la IA. No existe combinación
          // que produzca una sección de una fuente y un texto de la otra.
          expect(d.section).toBe(secIA);
          expect(d.reasoning).toContain('RAZON-IA');
          expect(d.ruleDissent).toBe(!requiresAI && secL4 !== secIA);
        }
      }
    }
  });
});
