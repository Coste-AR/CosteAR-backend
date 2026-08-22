/**
 * Matcheo de keywords con LÍMITE DE PALABRA — la evidencia del fix.
 *
 * El clasificador matcheaba sus keywords con `lower.includes(kw)`, que no sabe
 * dónde empieza una palabra. Cuatro colisiones medidas y reproducibles:
 *
 *   'raso'  (TEXTIL)       →  «at·RASO·»
 *   'sal'   (GASTRONOMIA)  →  «SAL·do», «SAL·ón», «SAL·ario»
 *   'API'   (SERVICIOS)    →  «c·API·tal»
 *   'pieza' (MANUFACTURA)  →  «lim·PIEZA·»
 *
 * Cada una sumaba un punto de MATERIA PRIMA a un documento que no tenía nada de
 * materia prima, y ese conteo es lo que decide la sección en layer4.
 *
 * Este archivo prueba las dos mitades del contrato, porque una sola no alcanza:
 *  1. las cuatro colisiones dejan de matchear, Y
 *  2. TODA keyword de TODOS los perfiles se sigue matcheando a sí misma
 *     (el riesgo real de un fix de fronteras es romper en silencio 'útiles de
 *     oficina', ' kg' o 'alq.'), y el plural que las listas daban por sentado
 *     ('vacuna' → "vacunas") se conserva.
 *
 * Todo es DETERMINISTA: corre sobre Layer 4 y sobre el matcher, no toca Groq ni
 * la base.
 */
import { describe, it, expect } from 'vitest';
import {
  keywordMatches,
  matchKeywords,
  countKeywords,
  firstKeywordMatch,
} from '@/infrastructure/classifier/utils/keyword-match.js';
import {
  getIndustryProfile,
  TRANSVERSAL_GASTO_KEYWORDS,
} from '@/infrastructure/classifier/industry/industry-profile.js';
import {
  UNIVERSAL_CIP_KEYWORDS,
  UNCONDITIONAL_CIP_KEYWORDS,
  ACQUISITION_INHERENT_KEYWORDS,
} from '@/infrastructure/classifier/layers/layer4-keywords.js';
import {
  MOD_ROLE_KEYWORDS,
  CIP_ROLE_KEYWORDS,
  ADMIN_ROLE_KEYWORDS,
} from '@/infrastructure/classifier/layers/layer4-payroll-routing.js';
import { runLayer4 } from '@/infrastructure/classifier/layers/layer4-business-routing.js';
import type { IndustryCategory } from '@/infrastructure/classifier/types.js';

const CATEGORIES: IndustryCategory[] = [
  'AGRO', 'AVICULTURA', 'GASTRONOMIA', 'MANUFACTURA', 'CONSTRUCCION',
  'TEXTIL', 'SALUD', 'SERVICIOS', 'COMERCIO', 'TRANSPORTE', 'DEFAULT',
];

/** Toda keyword que el clasificador matchea contra el texto de un documento. */
function todasLasKeywords(): { origen: string; keyword: string }[] {
  const out: { origen: string; keyword: string }[] = [];
  for (const cat of CATEGORIES) {
    const p = getIndustryProfile(cat);
    for (const [lista, kws] of [
      ['mpKeywords', p.mpKeywords], ['cipKeywords', p.cipKeywords],
      ['modKeywords', p.modKeywords], ['eventKeywords', p.eventKeywords],
      ['lossKeywords', p.lossKeywords],
    ] as const) {
      for (const kw of kws) out.push({ origen: `${cat}.${lista}`, keyword: kw });
    }
  }
  for (const [sub, kws] of Object.entries(TRANSVERSAL_GASTO_KEYWORDS)) {
    for (const kw of kws) out.push({ origen: `GASTO.${sub}`, keyword: kw });
  }
  for (const [origen, kws] of [
    ['UNIVERSAL_CIP', UNIVERSAL_CIP_KEYWORDS],
    ['UNCONDITIONAL_CIP', UNCONDITIONAL_CIP_KEYWORDS],
    ['ACQUISITION_INHERENT', ACQUISITION_INHERENT_KEYWORDS],
    ['MOD_ROLE', MOD_ROLE_KEYWORDS],
    ['CIP_ROLE', CIP_ROLE_KEYWORDS],
    ['ADMIN_ROLE', ADMIN_ROLE_KEYWORDS],
  ] as const) {
    for (const kw of kws) out.push({ origen, keyword: kw });
  }
  return out;
}

// ── 1. Las cuatro colisiones, en el matcher ──────────────────────────────────

describe('keywordMatches — las cuatro colisiones de substring dejan de matchear', () => {
  it.each([
    ['raso',  'atraso',    'Interés por atraso en el pago'],
    ['sal',   'saldo',     'Saldo anterior de la cuenta'],
    ['sal',   'salón',     'Alquiler salón para el evento'],
    ['sal',   'salario',   'Ajuste de salario del período'],
    ['API',   'capital',   'Asesoramiento sobre capital de trabajo'],
    ['pieza', 'limpieza',  'Servicio de limpieza industrial'],
  ])('«%s» ya no matchea adentro de «%s»', (keyword, _palabra, texto) => {
    expect(keywordMatches(texto, keyword)).toBe(false);
  });

  it('pero cada una SÍ matchea cuando es la palabra de verdad', () => {
    expect(keywordMatches('Tela de raso blanco, 40 metros', 'raso')).toBe(true);
    expect(keywordMatches('2 kg de sal fina', 'sal')).toBe(true);
    expect(keywordMatches('Consumo de API de terceros', 'API')).toBe(true);
    expect(keywordMatches('Pieza de repuesto para la línea', 'pieza')).toBe(true);
  });
});

// ── 2. Nada de lo que matcheaba y debía matchear se rompió ───────────────────

describe('keywordMatches — ninguna keyword existente quedó rota', () => {
  const keywords = todasLasKeywords();

  it(`las ${keywords.length} keywords de todos los perfiles y listas se matchean a sí mismas`, () => {
    const rotas = keywords.filter(({ keyword }) => !keywordMatches(keyword, keyword));

    expect(rotas).toEqual([]);
  });

  it('también se matchean dentro de una frase (no solo aisladas)', () => {
    const rotas = keywords.filter(
      ({ keyword }) => !keywordMatches(`comprobante 0001: ${keyword} del período`, keyword),
    );

    expect(rotas).toEqual([]);
  });

  it.each([
    // Estas tres son las que un `\b` de JavaScript habría roto: `\b` está definido
    // sobre [A-Za-z0-9_], así que la 'ú' inicial y la 'ó' final quedan del lado
    // equivocado de la frontera, y ' kg' viene siempre después de un dígito.
    ['útiles de oficina', 'Compra de útiles de oficina para el estudio'],
    ['senasa clausuró',   'El senasa clausuró el establecimiento'],
    [' kg',               'Remito por 500 kg de harina'],
    // Keywords con punto: la frontera de la derecha no se exige (ya la da el punto)
    // y el punto se escapa, así que no funciona como comodín.
    ['alq.',              'alq. local comercial'],
    // Multi-word con tilde y con ñ: el límite es de la FRASE, no de cada palabra.
    ['energía eléctrica', 'ENERGÍA ELÉCTRICA — suministro de planta'],
    ['alimento balanceado', 'Compra de alimento balanceado para ponedoras'],
    ['campaña publicitaria', 'Campaña publicitaria de verano'],
    // Sin espacio contra un número: los dígitos no cuentan como letra a propósito.
    ['kwh',               'consumo 12000kwh del período'],
  ])('«%s» matchea en «%s»', (keyword, texto) => {
    expect(keywordMatches(texto, keyword)).toBe(true);
  });

  it.each([
    ['vacuna',   'Compra de vacunas para el plantel'],
    ['jaula',    'Reposición de jaulas del galpón'],
    ['material', 'Compra de materiales varios'],
    ['alquiler', 'Alquileres del trimestre'],
    ['operario', 'Liquidación de operarios'],
  ])('el plural se conserva: «%s» matchea en «%s»', (keyword, texto) => {
    expect(keywordMatches(texto, keyword)).toBe(true);
  });

  it('pero el plural es lo ÚNICO que se admite: no cualquier sufijo', () => {
    // "saldo" es 'sal' + "do"; si se admitiera cualquier sufijo volvería la
    // colisión que este fix vino a cerrar.
    expect(keywordMatches('saldo', 'sal')).toBe(false);
    expect(keywordMatches('salsa de tomate', 'sal')).toBe(false);
    expect(keywordMatches('directorio', 'director')).toBe(false);
    expect(keywordMatches('reparación de comederos', 'ración')).toBe(false);
  });
});

describe('helpers del matcher', () => {
  it('matchKeywords devuelve las que matchean, en el orden de la lista', () => {
    expect(matchKeywords('Compra de tela y de hilo', ['tela', 'raso', 'hilo'])).toEqual(['tela', 'hilo']);
  });

  it('countKeywords cuenta sin duplicar', () => {
    expect(countKeywords('tela, tela y más tela', ['tela', 'raso'])).toBe(1);
  });

  it('firstKeywordMatch respeta la prioridad de la lista', () => {
    expect(firstKeywordMatch('jefe de planta', ['supervisor', 'jefe de planta'])).toBe('jefe de planta');
    expect(firstKeywordMatch('recepcionista', ['operario', 'peón'])).toBeNull();
  });
});

// ── 3. Las cuatro colisiones, extremo a extremo por runLayer4 ────────────────
//
// Acá está el impacto real: en los cuatro casos la colisión cambiaba la sección
// que el sistema le devolvía al costista.

const factura = (proveedor: string, detalle: string) => `
FACTURA A
CAE Nº: 75200000000301
CUIT: 30-54668943-1
Proveedor: ${proveedor}
Fecha: 05/07/2026
${detalle}
`;

describe('runLayer4 — el efecto de las colisiones en la clasificación', () => {
  it("TEXTIL: 'raso' dentro de «atraso» hacía empatar a un gasto financiero con Materia Prima", () => {
    // Antes: mpScore 1 (por 'raso' en "atraso") empataba con la señal de gasto y
    // la factura salía DESCONOCIDO / requiresAI. Ahora se resuelve sola.
    const r = runLayer4(
      'FACTURA_COMPRA',
      factura('Banco Galicia', 'Comisión bancaria por atraso en la acreditación'),
      'TEXTIL',
    );

    expect(r.costSection).toBe('GASTO_FINANCIERO');
    expect(r.requiresAI).toBe(false);
  });

  it("GASTRONOMIA: 'sal' dentro de «salón» mandaba el alquiler del salón a la IA", () => {
    const r = runLayer4(
      'FACTURA_COMPRA',
      factura('Inmobiliaria Centro SRL', 'Alquiler salón — julio 2026'),
      'GASTRONOMIA',
    );

    expect(r.costSection).toBe('COSTOS_INDIRECTOS');
    expect(r.requiresAI).toBe(false);
  });

  it("MANUFACTURA: 'pieza' dentro de «limpieza» mandaba la limpieza industrial a la IA", () => {
    const r = runLayer4(
      'FACTURA_COMPRA',
      factura('Higiene Industrial SA', 'Servicio de limpieza industrial de planta'),
      'MANUFACTURA',
    );

    expect(r.costSection).toBe('COSTOS_INDIRECTOS');
    expect(r.requiresAI).toBe(false);
  });

  it("SERVICIOS: 'API' dentro de «capital» afirmaba MATERIA PRIMA con confianza 85", () => {
    // El peor de los cuatro: no dudaba, afirmaba. Ahora reconoce que no sabe.
    const r = runLayer4(
      'FACTURA_COMPRA',
      factura('Estudio Contable Norte', 'Asesoramiento sobre capital de trabajo'),
      'SERVICIOS',
    );

    expect(r.costSection).not.toBe('MATERIA_PRIMA');
    expect(r.requiresAI).toBe(true);
  });

  it('y lo que sí es materia prima en cada rubro se sigue clasificando igual', () => {
    expect(
      runLayer4('FACTURA_COMPRA', factura('Textiles del Sur', 'Tela de raso — 120 metros'), 'TEXTIL').costSection,
    ).toBe('MATERIA_PRIMA');
    expect(
      runLayer4('FACTURA_COMPRA', factura('Distribuidora Gastro', '25 kg de sal fina y 40 kg de harina'), 'GASTRONOMIA').costSection,
    ).toBe('MATERIA_PRIMA');
    expect(
      runLayer4('FACTURA_COMPRA', factura('Metalúrgica Rossi', 'Piezas de acero para la línea de producción'), 'MANUFACTURA').costSection,
    ).toBe('MATERIA_PRIMA');
  });
});
