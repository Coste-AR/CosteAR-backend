/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CONDICIÓN FRENTE AL IVA — el importe que entra al costo lo decide la EMPRESA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * QUÉ PROTEGE (dos cosas distintas, y la primera es la más importante)
 * -------------------------------------------------------------------
 *
 * 1. NO-REGRESIÓN, PROBADA CONTRA UN ORÁCULO — no afirmada.
 *
 *    La corrección CL-01 dejó una precedencia fija: neto → (total − IVA) → total.
 *    CL-09 la generaliza: ahora hay DOS precedencias y la elige
 *    `Company.condicionIva`. La migración pone RESPONSABLE_INSCRIPTO en todas
 *    las empresas existentes, así que la rama que corre para todo lo que ya
 *    está en la base tiene que ser IDÉNTICA a la de CL-01.
 *
 *    "Idéntica" acá no es una opinión: el bloque ORÁCULO de abajo es la
 *    implementación de CL-01 copiada literal, y el test la corre contra la
 *    implementación actual sobre una GRILLA EXHAUSTIVA de entradas —todas las
 *    combinaciones de netAmount × taxAmount × totalAmount sobre un dominio que
 *    incluye null, undefined, 0, negativos, NaN, Infinity, strings, decimales
 *    con ruido de punto flotante y los importes reales del corpus. Son miles de
 *    casos. Si UNO SOLO difiere, el test imprime la terna exacta que difiere.
 *
 *    Eso convierte "ningún costo ya calculado cambia" en una propiedad
 *    verificada sobre todo el espacio de entradas de la función, no en una
 *    inspección de tres ejemplos.
 *
 * 2. La regla contable nueva: para un monotributista o un exento el IVA SÍ es
 *    costo (cátedra, Clase 4, línea 27), así que el importe es el TOTAL. Se
 *    assertan los tres casos del corpus con el subcosteo exacto que se estaría
 *    metiendo si alguien costeara el neto para esas empresas.
 *
 * CÓMO CORRERLO
 *   npx vitest run tests/validaciones/ledger-condicion-iva.test.ts
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  buildLedgerDraft,
  ivaEsCosto,
  CONDICION_IVA_POR_DEFECTO,
  type CondicionIva,
} from '../../src/application/validaciones/ledger-builder.js';

// ════════════════════════════════════════════════════════════════════════════
// ORÁCULO — `pickCostAmount` tal como quedó en CL-01, copiado literal.
// NO SE TOCA. Es la referencia contra la que se mide la no-regresión.
// ════════════════════════════════════════════════════════════════════════════

interface EdOraculo {
  totalAmount?: number | null;
  netAmount?: number | null;
  taxAmount?: number | null;
}

function usableNumberCL01(v: number | null | undefined): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function pickCostAmountCL01(ed: EdOraculo | null): number | null {
  const net = usableNumberCL01(ed?.netAmount);
  if (net != null) return net;

  const total = usableNumberCL01(ed?.totalAmount);
  if (total == null) return null;

  const tax = usableNumberCL01(ed?.taxAmount);
  if (tax != null && tax > 0 && tax < total) {
    return Math.round((total - tax) * 1e4) / 1e4;
  }
  return total;
}

/**
 * El resto de `buildLedgerDraft` que CL-01 aplicaba sobre ese importe, para
 * comparar el RESULTADO FINAL (una línea de costo o ninguna), no solo el monto
 * intermedio: sin monto positivo no hay línea, y ≥ 1e14 desborda la columna.
 */
function montoFinalCL01(ed: EdOraculo): number | null {
  const amount = pickCostAmountCL01(ed);
  if (amount == null || !Number.isFinite(amount) || amount <= 0) return null;
  if (amount >= 1e14) return null;
  return amount;
}

// ── Utilidades ──────────────────────────────────────────────────────────────

function reviewNote(ed: Record<string, unknown>): string {
  return JSON.stringify({
    extractedData: {
      date: '2026-06-12',
      supplier: 'Proveedor de prueba SRL',
      invoiceNumber: '0001-00001854',
      currency: 'ARS',
      ...ed,
    },
  });
}

function montoActual(ed: Record<string, unknown>, condicionIva?: CondicionIva | null): number | null {
  const d = buildLedgerDraft({
    aiReviewNote: reviewNote(ed),
    documentType: 'FACTURA_COMPRA',
    fallbackDescription: 'fallback',
    condicionIva,
  });
  return d ? d.amount : null;
}

// ── Corpus: los importes reales medidos por la auditoría ────────────────────

interface CorpusCaseMontos {
  id: string;
  montos?: { netAmount?: number; taxAmount?: number; totalAmount?: number; alicuota?: number };
}

const CORPUS_PATH = fileURLToPath(new URL('../../corpus-clasificador/corpus.json', import.meta.url));

function casosDelCorpus(ids: string[]): CorpusCaseMontos[] {
  const corpus = JSON.parse(readFileSync(CORPUS_PATH, 'utf8')) as { casos: CorpusCaseMontos[] };
  return ids.map((id) => {
    const caso = corpus.casos.find((c) => c.id === id);
    if (!caso?.montos) throw new Error(`corpus.json no tiene los montos del caso ${id}.`);
    return caso;
  });
}

const CASOS_IVA = casosDelCorpus(['MP-01', 'MP-03', 'MP-06']);

// ════════════════════════════════════════════════════════════════════════════
// 1. NO-REGRESIÓN: la rama RI es la de CL-01, sobre TODO el espacio de entradas
// ════════════════════════════════════════════════════════════════════════════

describe('CL-09 no revalúa nada: la rama Responsable Inscripto es CL-01, verificada contra el oráculo', () => {
  /**
   * Dominio de cada campo. Cubre lo normal (importes reales), lo degenerado
   * (0, negativos), lo roto (NaN, Infinity, strings, objetos) y los bordes de
   * la resta (tax = total, tax > total, tax microscópico).
   */
  const VALORES: unknown[] = [
    undefined, null,
    0, -1, -12_100_000,
    1, 0.0001, 0.00005,
    100_000.02, 121_000.03, 21_000.01,
    9_870_000, 10_000_000, 10_906_350, 11_025_000, 12_100_000, 12_182_625, 2_100_000, 1_036_350, 1_157_625,
    1e13, 1e14, 1e15,
    NaN, Infinity, -Infinity,
    '10000' as unknown as number, 'no-es-numero' as unknown as number,
    {} as unknown as number,
  ];

  it(`la grilla exhaustiva (${VALORES.length}³ = ${VALORES.length ** 3} ternas) da EXACTAMENTE lo mismo que CL-01`, () => {
    const diferencias: string[] = [];
    let comparadas = 0;

    for (const netAmount of VALORES) {
      for (const taxAmount of VALORES) {
        for (const totalAmount of VALORES) {
          const ed = { netAmount, taxAmount, totalAmount } as Record<string, unknown>;

          const esperado = montoFinalCL01(ed as EdOraculo);
          // Las tres formas en que una empresa preexistente llega al builder:
          // con la condición explícita, con null (columna sin leer) y sin el
          // parámetro (los llamadores viejos y los tests de CL-01).
          const conExplicita = montoActual(ed, 'RESPONSABLE_INSCRIPTO');
          const conNull = montoActual(ed, null);
          const sinParametro = montoActual(ed);

          comparadas++;
          if (
            !Object.is(conExplicita, esperado) ||
            !Object.is(conNull, esperado) ||
            !Object.is(sinParametro, esperado)
          ) {
            diferencias.push(
              `net=${String(netAmount)} tax=${String(taxAmount)} total=${String(totalAmount)} → ` +
                `CL-01 daba ${String(esperado)}, ahora da ${String(conExplicita)} ` +
                `(null: ${String(conNull)}, sin parámetro: ${String(sinParametro)})`,
            );
          }
        }
      }
    }

    expect(comparadas).toBe(VALORES.length ** 3);
    expect(
      diferencias,
      `CL-09 CAMBIÓ el importe de ${diferencias.length} entradas para un Responsable Inscripto. ` +
        `Toda empresa preexistente quedó en RESPONSABLE_INSCRIPTO por la migración, así que esto ` +
        `sería una revaluación silenciosa de datos vivos. Primeras diferencias:\n` +
        diferencias.slice(0, 10).join('\n'),
    ).toEqual([]);
  });

  it('el default de la función es el mismo que el @default de la columna', () => {
    expect(CONDICION_IVA_POR_DEFECTO).toBe('RESPONSABLE_INSCRIPTO');
    expect(ivaEsCosto(undefined)).toBe(false);
    expect(ivaEsCosto(null)).toBe(false);
    expect(ivaEsCosto('RESPONSABLE_INSCRIPTO')).toBe(false);
    expect(ivaEsCosto('MONOTRIBUTO')).toBe(true);
    expect(ivaEsCosto('EXENTO')).toBe(true);
  });

  it('los tres casos del corpus siguen valiendo el neto para un RI', () => {
    for (const caso of CASOS_IVA) {
      const { netAmount } = caso.montos!;
      expect(montoActual(caso.montos as Record<string, unknown>, 'RESPONSABLE_INSCRIPTO')).toBe(netAmount);
      expect(montoActual(caso.montos as Record<string, unknown>)).toBe(netAmount);
    }
  });

  it('el union local de condiciones no se desincroniza del enum de Prisma', async () => {
    // Si alguien agrega un valor al enum de Prisma y no acá, el builder lo
    // trataría como "no RI" por descarte y costearía con IVA sin que nadie lo
    // haya decidido. Se compara contra el schema, que es la fuente de verdad.
    const schema = readFileSync(fileURLToPath(new URL('../../prisma/schema.prisma', import.meta.url)), 'utf8');
    const bloque = /enum\s+CondicionIva\s*\{([^}]*)\}/.exec(schema);
    expect(bloque, 'prisma/schema.prisma perdió el enum CondicionIva').not.toBeNull();
    const enPrisma = bloque![1]!
      .split('\n')
      .map((l) => l.replace(/\/\/.*$/, '').trim())
      .filter((l) => /^[A-Z_]+$/.test(l))
      .sort();
    expect(enPrisma).toEqual(['EXENTO', 'MONOTRIBUTO', 'RESPONSABLE_INSCRIPTO']);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 2. La regla nueva: monotributista / exento → el IVA ES costo
// ════════════════════════════════════════════════════════════════════════════

describe('monotributista y exento: el IVA no se recupera, así que ES costo', () => {
  const NO_RECUPERAN: CondicionIva[] = ['MONOTRIBUTO', 'EXENTO'];

  for (const condicion of NO_RECUPERAN) {
    for (const caso of CASOS_IVA) {
      const { netAmount, taxAmount, totalAmount, alicuota } = caso.montos!;
      const pct = alicuota != null ? `${(alicuota * 100).toFixed(1)} %` : 'IVA';

      it(`${condicion} · ${caso.id} (alícuota ${pct}): la línea vale ${totalAmount}, no ${netAmount}`, () => {
        const amount = montoActual(caso.montos as Record<string, unknown>, condicion);

        expect(amount).toBe(totalAmount);

        const subcosteoPct = ((netAmount! - totalAmount!) / totalAmount!) * 100;
        expect(
          amount,
          `${caso.id}: entró el neto ${netAmount} en vez del total ${totalAmount} — ` +
            `subcosteo de ${subcosteoPct.toFixed(1)} %. Para un ${condicion} el IVA integra el costo ` +
            `(Clase 4, línea 27 del vault).`,
        ).not.toBe(netAmount);

        // El IVA quedó adentro, exactamente.
        expect(amount! - netAmount!).toBeCloseTo(taxAmount!, 4);
      });
    }
  }

  it('sin total pero con neto e IVA discriminado, el total se reconstruye por suma', () => {
    const { netAmount, taxAmount, totalAmount } = CASOS_IVA.find((c) => c.id === 'MP-06')!.montos!;
    const amount = montoActual({ netAmount, taxAmount }, 'MONOTRIBUTO');
    expect(amount).toBe(totalAmount);
    expect(amount).not.toBe(netAmount);
  });

  it('sin total y sin IVA discriminado no hay nada que sumar: queda el neto', () => {
    const { netAmount } = CASOS_IVA.find((c) => c.id === 'MP-06')!.montos!;
    expect(montoActual({ netAmount }, 'MONOTRIBUTO')).toBe(netAmount);
    expect(montoActual({ netAmount, taxAmount: 0 }, 'EXENTO')).toBe(netAmount);
    expect(montoActual({ netAmount, taxAmount: -5 }, 'EXENTO')).toBe(netAmount);
  });

  it('la suma no arrastra ruido de punto flotante', () => {
    expect(montoActual({ netAmount: 100000.02, taxAmount: 21000.01 }, 'MONOTRIBUTO')).toBe(121000.03);
  });

  it('la Factura C (solo total, sin desglose) vale lo mismo para las tres condiciones', () => {
    // Es el caso donde la distinción no existe: no hay IVA discriminado que
    // sacar ni que poner, y el total ES el costo para todos.
    const soloTotal = { totalAmount: 250_000 };
    expect(montoActual(soloTotal, 'RESPONSABLE_INSCRIPTO')).toBe(250_000);
    expect(montoActual(soloTotal, 'MONOTRIBUTO')).toBe(250_000);
    expect(montoActual(soloTotal, 'EXENTO')).toBe(250_000);
  });

  it('el draft deja registrada la condición con la que se resolvió el importe', () => {
    const d = buildLedgerDraft({
      aiReviewNote: reviewNote({ netAmount: 100, taxAmount: 21, totalAmount: 121 }),
      documentType: 'FACTURA_COMPRA',
      fallbackDescription: 'x',
      condicionIva: 'MONOTRIBUTO',
    });
    expect(d?.condicionIva).toBe('MONOTRIBUTO');
    expect(d?.amount).toBe(121);

    const sinCondicion = buildLedgerDraft({
      aiReviewNote: reviewNote({ netAmount: 100, taxAmount: 21, totalAmount: 121 }),
      documentType: 'FACTURA_COMPRA',
      fallbackDescription: 'x',
    });
    expect(sinCondicion?.condicionIva).toBe('RESPONSABLE_INSCRIPTO');
    expect(sinCondicion?.amount).toBe(100);
  });

  it('los topes de seguridad valen igual con IVA adentro', () => {
    // ≥ 1e14 desborda Decimal(18,4): no hay línea, con cualquier condición.
    expect(montoActual({ totalAmount: 1e15 }, 'MONOTRIBUTO')).toBeNull();
    // La suma también puede cruzar el tope.
    expect(montoActual({ netAmount: 9.9e13, taxAmount: 1e13 }, 'MONOTRIBUTO')).toBeNull();
    // Sin monto positivo tampoco hay línea.
    expect(montoActual({ totalAmount: 0 }, 'EXENTO')).toBeNull();
    expect(montoActual({ totalAmount: -50 }, 'EXENTO')).toBeNull();
  });
});
