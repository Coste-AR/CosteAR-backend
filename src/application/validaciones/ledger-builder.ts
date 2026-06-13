// src/application/validaciones/ledger-builder.ts

/**
 * Construye los datos de una línea del libro mayor a partir del análisis de IA
 * que quedó guardado en la entrada (reviewNote, JSON) más la clasificación final.
 *
 * El período sale de la fecha del documento (no de la fecha de aprobación): un
 * costo pertenece al mes del comprobante. Si no hay fecha legible, cae al mes
 * actual. El monto preferido es el total; si no, el neto.
 */

interface ExtractedData {
  date?: string | null;
  supplier?: string | null;
  invoiceNumber?: string | null;
  totalAmount?: number | null;
  netAmount?: number | null;
  currency?: string | null;
}

interface AiAnalysis {
  extractedData?: ExtractedData | null;
}

export interface LedgerDraft {
  period: string;
  supplier: string | null;
  description: string;
  amount: number;
  currency: string;
  docDate: Date | null;
}

/** "YYYY-MM" del mes actual. */
function currentPeriod(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Parsea una fecha "YYYY-MM-DD" (u otros formatos comunes) a Date o null. */
function parseDocDate(raw?: string | null): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Devuelve el draft del libro mayor, o null si no hay un monto utilizable
 * (sin monto no tiene sentido una línea de costo — eso va a revisión manual).
 */
export function buildLedgerDraft(params: {
  aiReviewNote: string | null;
  documentType: string;
  fallbackDescription: string;
}): LedgerDraft | null {
  let ai: AiAnalysis | null = null;
  if (params.aiReviewNote) {
    try {
      const parsed = JSON.parse(params.aiReviewNote) as AiAnalysis;
      if (parsed && typeof parsed === 'object') ai = parsed;
    } catch {
      ai = null;
    }
  }

  const ed = ai?.extractedData ?? null;
  const amount = (ed?.totalAmount != null && Number.isFinite(ed.totalAmount))
    ? Number(ed.totalAmount)
    : (ed?.netAmount != null && Number.isFinite(ed.netAmount))
      ? Number(ed.netAmount)
      : null;

  if (amount == null || amount <= 0) return null;

  const docDate = parseDocDate(ed?.date);
  const period = docDate
    ? `${docDate.getUTCFullYear()}-${String(docDate.getUTCMonth() + 1).padStart(2, '0')}`
    : currentPeriod();

  const supplier = ed?.supplier?.trim() || null;
  const invoice = ed?.invoiceNumber?.trim();
  const description = [supplier, invoice ? `Comp. ${invoice}` : null]
    .filter(Boolean)
    .join(' · ') || params.fallbackDescription;

  return {
    period,
    supplier,
    description,
    amount,
    currency: ed?.currency?.trim() || 'ARS',
    docDate,
  };
}
