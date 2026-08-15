/**
 * ═══════════════════════════════════════════════════════════════════════════
 * EL IVA NO ENTRA AL COSTO — guarda de regresión del importe del libro mayor
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * QUÉ PROTEGE
 * -----------
 * `buildLedgerDraft` prefería `totalAmount` (CON IVA) y solo caía a `netAmount`.
 * Medido de punta a punta, eso metía al costo:
 *
 *   MP-06  neto 10.000.000 → 12.100.000 (+21,0 %)
 *   MP-03  neto  9.870.000 → 10.906.350 (+10,5 %)
 *   MP-01  neto 11.025.000 → 12.182.625 (+10,5 %)
 *
 * La regla contable está en el vault de la cátedra, Clase 4 ("Materia prima —
 * costo de adquisición, desperdicio y lote económico"), línea 27: "IVA: solo
 * aplica si la empresa es responsable no inscripta o monotributista; si es
 * responsable inscripta, el IVA no forma parte del costo de adquisición".
 * El primer cliente pagante es Responsable Inscripto con saldo a favor de IVA,
 * así que para él el costo es, sin ambigüedad, el NETO.
 *
 * DE DÓNDE SALEN LOS NÚMEROS
 * --------------------------
 * De `corpus-clasificador/corpus.json`, no tipeados a mano acá: los casos MP-01,
 * MP-03 y MP-06 llevan sus `montos` ({ netAmount, taxAmount, totalAmount }) y su
 * `baseline.montoQueLlegoAlCosto` (lo que la auditoría midió que entraba mal).
 * Una sola fuente de verdad: si el corpus cambia, este test mide lo nuevo.
 *
 * POR QUÉ FALLA FUERTE SI SE INVIERTE LA PRECEDENCIA
 * --------------------------------------------------
 * No alcanza con "el monto es el neto": se asserta ADEMÁS que el monto NO es el
 * total ni el importe inflado que reportó la auditoría, y que el sobrecosteo
 * relativo es exactamente 0. Volver a preferir `totalAmount` pone en rojo tres
 * casos con el porcentaje de sobrecosteo impreso en el mensaje.
 *
 * CÓMO CORRERLO
 *   npx vitest run tests/validaciones/ledger-iva-neto.test.ts
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildLedgerDraft } from '../../src/application/validaciones/ledger-builder.js';

// ── Corpus: única fuente de los importes ─────────────────────────────────────

interface CorpusCaseMontos {
  id: string;
  montos?: { netAmount?: number; taxAmount?: number; totalAmount?: number; alicuota?: number };
  baseline?: { montoQueLlegoAlCosto?: number } | null;
  text?: string;
}

const CORPUS_PATH = fileURLToPath(
  new URL('../../corpus-clasificador/corpus.json', import.meta.url),
);

function loadCasosConMontos(ids: string[]): CorpusCaseMontos[] {
  const corpus = JSON.parse(readFileSync(CORPUS_PATH, 'utf8')) as { casos: CorpusCaseMontos[] };
  return ids.map((id) => {
    const caso = corpus.casos.find((c) => c.id === id);
    if (!caso) throw new Error(`corpus.json no tiene el caso ${id} — este test depende de él.`);
    if (!caso.montos || caso.montos.netAmount == null || caso.montos.totalAmount == null) {
      throw new Error(`El caso ${id} de corpus.json perdió sus montos (netAmount/totalAmount).`);
    }
    return caso;
  });
}

const CASOS_IVA = loadCasosConMontos(['MP-01', 'MP-03', 'MP-06']);

/** reviewNote tal como lo deja el analizador de Groq para un comprobante. */
function reviewNote(montos: CorpusCaseMontos['montos'], extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    extractedData: {
      date: '2026-06-12',
      supplier: 'Proveedor de prueba SRL',
      invoiceNumber: '0001-00001854',
      currency: 'ARS',
      netAmount: montos?.netAmount ?? null,
      taxAmount: montos?.taxAmount ?? null,
      totalAmount: montos?.totalAmount ?? null,
      ...extra,
    },
  });
}

function draftAmount(note: string): number {
  const d = buildLedgerDraft({
    aiReviewNote: note,
    documentType: 'FACTURA_COMPRA',
    fallbackDescription: 'fallback',
  });
  expect(d).not.toBeNull();
  return d!.amount;
}

// ── Los tres casos medidos por la auditoría ──────────────────────────────────

describe('libro mayor — el importe que entra al costo es el NETO, nunca el total con IVA', () => {
  for (const caso of CASOS_IVA) {
    const { netAmount, taxAmount, totalAmount, alicuota } = caso.montos!;
    const pct = alicuota != null ? `${(alicuota * 100).toFixed(1)} %` : 'IVA';

    it(`${caso.id} (alícuota ${pct}): neto ${netAmount} y total ${totalAmount} → la línea vale ${netAmount}`, () => {
      const amount = draftAmount(reviewNote(caso.montos));

      // 1. Es el neto.
      expect(amount).toBe(netAmount);

      // 2. NO es el total con IVA. Si alguien invierte la precedencia, este
      //    assert imprime el sobrecosteo exacto que se estaría metiendo.
      const sobrecosteoPct = ((amount - netAmount!) / netAmount!) * 100;
      expect(
        amount,
        `${caso.id}: entró ${amount} en vez del neto ${netAmount} — ` +
          `sobrecosteo de ${sobrecosteoPct.toFixed(1)} %. El IVA no es costo para un ` +
          `Responsable Inscripto (Clase 4, línea 27 del vault).`,
      ).not.toBe(totalAmount);

      // 3. Tampoco es el importe inflado que midió la auditoría del 06/08/2026.
      const medidoPorLaAuditoria = caso.baseline?.montoQueLlegoAlCosto;
      if (medidoPorLaAuditoria != null) {
        expect(amount, `${caso.id}: volvió el bug medido por la auditoría.`).not.toBe(medidoPorLaAuditoria);
      }

      // 4. Sobrecosteo cero, exacto.
      expect(sobrecosteoPct).toBe(0);

      // 5. Y el IVA del comprobante quedó realmente afuera.
      expect(totalAmount! - amount).toBeCloseTo(taxAmount!, 4);
    });
  }

  // El caso más caro, escrito aparte y explícito: es el que la spec pide
  // assertar por número. Los valores igual salen del corpus.
  it('MP-06: neto 10.000.000 con total 12.100.000 produce una línea de 10.000.000', () => {
    const mp06 = CASOS_IVA.find((c) => c.id === 'MP-06')!;
    expect(mp06.montos!.netAmount).toBe(10_000_000);
    expect(mp06.montos!.totalAmount).toBe(12_100_000);
    expect(draftAmount(reviewNote(mp06.montos))).toBe(10_000_000);
  });
});

// ── Precedencia completa ─────────────────────────────────────────────────────

describe('libro mayor — precedencia neto → (total − IVA) → total', () => {
  const mp06 = () => CASOS_IVA.find((c) => c.id === 'MP-06')!.montos!;

  it('el neto gana aunque vengan los tres campos', () => {
    expect(draftAmount(reviewNote(mp06()))).toBe(mp06().netAmount);
  });

  it('sin neto pero con IVA discriminado, el neto se deriva por resta (no se usa el total)', () => {
    const { taxAmount, totalAmount, netAmount } = mp06();
    const amount = draftAmount(reviewNote({ taxAmount, totalAmount }));
    expect(amount).toBe(netAmount);
    expect(amount).not.toBe(totalAmount);
  });

  it('sin neto y sin IVA discriminado (Factura C / ticket) cae al total: ahí el total ES el costo', () => {
    const { totalAmount } = mp06();
    expect(draftAmount(reviewNote({ totalAmount }))).toBe(totalAmount);
  });

  it('un taxAmount inconsistente (0, negativo o ≥ total) no se resta: cae al total', () => {
    const { totalAmount } = mp06();
    expect(draftAmount(reviewNote({ totalAmount, taxAmount: 0 }))).toBe(totalAmount);
    expect(draftAmount(reviewNote({ totalAmount, taxAmount: -100 }))).toBe(totalAmount);
    expect(draftAmount(reviewNote({ totalAmount, taxAmount: totalAmount }))).toBe(totalAmount);
    expect(draftAmount(reviewNote({ totalAmount, taxAmount: totalAmount! + 1 }))).toBe(totalAmount);
  });

  it('la resta no arrastra ruido de punto flotante', () => {
    expect(draftAmount(reviewNote({ totalAmount: 121000.03, taxAmount: 21000.01 }))).toBe(100000.02);
  });

  it('un neto no numérico no habilita el total con IVA: sin monto válido no hay línea', () => {
    // netAmount inválido + total sin IVA discriminado → cae al total (es lo único
    // que hay). Pero si el neto es 0 explícito, no hay línea de costo.
    expect(
      buildLedgerDraft({
        aiReviewNote: reviewNote({ netAmount: 0, totalAmount: 12_100_000, taxAmount: 2_100_000 }),
        documentType: 'FACTURA_COMPRA',
        fallbackDescription: 'x',
      }),
    ).toBeNull();
  });
});
