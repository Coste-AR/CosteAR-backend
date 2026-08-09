// src/application/validaciones/ledger-builder.ts

/**
 * Construye los datos de una línea del libro mayor a partir del análisis de IA
 * que quedó guardado en la entrada (reviewNote, JSON) más la clasificación final.
 *
 * El período sale de la fecha del documento (no de la fecha de aprobación): un
 * costo pertenece al mes del comprobante. Si no hay fecha legible, cae al mes
 * actual.
 *
 * QUÉ IMPORTE ENTRA AL COSTO — LO DECIDE LA CONDICIÓN FRENTE AL IVA
 * -----------------------------------------------------------------
 * La cátedra (Clase 4, "Materia prima — costo de adquisición, desperdicio y
 * lote económico", línea 27) es explícita: "IVA: solo aplica si la empresa es
 * responsable no inscripta o monotributista; si es responsable inscripta, el
 * IVA no forma parte del costo de adquisición".
 *
 * O sea que no hay una precedencia única y universal: hay DOS, y la elige la
 * empresa, no el documento.
 *
 *   RESPONSABLE_INSCRIPTO → el IVA es crédito fiscal, se recupera.
 *     El costo es el NETO: netAmount → (totalAmount − taxAmount) → totalAmount.
 *     Tomar el total inflaba cada línea un 10,5 % o un 21 % según la alícuota.
 *     El último escalón es el único caso en que el IVA queda adentro: el
 *     documento no discrimina nada (Factura C, ticket sin desglose) y ahí el
 *     total ES lo único que hay.
 *
 *   MONOTRIBUTO / EXENTO → el IVA NO se recupera, es un costo más.
 *     El costo es el TOTAL: totalAmount → (netAmount + taxAmount) → netAmount.
 *     Costear sobre el neto acá SUBVALÚA el costo real de la misma magnitud con
 *     la que costear sobre el total lo sobrevalúa para un RI.
 *
 * Sin condición explícita se asume RESPONSABLE_INSCRIPTO, que es el default de
 * la columna `Company.condicionIva` y el supuesto bajo el que se calculó todo
 * lo que ya existe (el prompt de la IA dice "Asumí Responsable Inscripto por
 * defecto"). Ver DECISIONES.md, sección CL-09.
 */

/**
 * Condición de la empresa frente al IVA. Espejo del enum `CondicionIva` de
 * Prisma, escrito a mano a propósito: este módulo es una función pura sobre el
 * JSON de la IA y no debe arrastrar `@prisma/client` (lo testea un archivo que
 * no levanta base). El test `condicionIva — el union local no se desincroniza
 * del enum de Prisma` verifica que los dos conjuntos de valores coincidan.
 */
export type CondicionIva = 'RESPONSABLE_INSCRIPTO' | 'MONOTRIBUTO' | 'EXENTO';

/**
 * Qué se asume cuando nadie dijo nada. Tiene que ser el MISMO valor que el
 * `@default` de `Company.condicionIva`: si divergieran, una empresa creada
 * antes de la migración costearía distinto según por dónde entre el dato.
 */
export const CONDICION_IVA_POR_DEFECTO: CondicionIva = 'RESPONSABLE_INSCRIPTO';

/** ¿El IVA de los comprobantes de esta empresa es costo (true) o crédito fiscal (false)? */
export function ivaEsCosto(condicion: CondicionIva | null | undefined): boolean {
  return (condicion ?? CONDICION_IVA_POR_DEFECTO) !== 'RESPONSABLE_INSCRIPTO';
}

interface ExtractedData {
  date?: string | null;
  supplier?: string | null;
  invoiceNumber?: string | null;
  totalAmount?: number | null;
  netAmount?: number | null;
  taxAmount?: number | null;
  currency?: string | null;
}

interface AiAnalysis {
  extractedData?: ExtractedData | null;
}

export interface LedgerDraft {
  period: string;
  supplier: string | null;
  description: string;
  /**
   * El importe que entra al costo. Para un Responsable Inscripto es el NETO
   * (sin IVA); para un monotributista o un exento es el TOTAL (con IVA, porque
   * ahí el IVA no se recupera y es costo). Ver `pickCostAmount`.
   */
  amount: number;
  currency: string;
  docDate: Date | null;
  /** Con qué condición frente al IVA se resolvió `amount`. Queda para trazar. */
  condicionIva: CondicionIva;
}

/** "YYYY-MM" del mes actual. */
function currentPeriod(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Número utilizable o null (descarta null/undefined/NaN/Infinity). */
function usableNumber(v: number | null | undefined): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Redondeo a 4 decimales: la precisión de la columna `Decimal(18,4)`. */
function a4Decimales(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

/**
 * RESPONSABLE INSCRIPTO — el IVA se recupera, el costo es el NETO. Prioridad:
 *
 *   1. `netAmount` — lo que el comprobante declara como neto gravado.
 *   2. `totalAmount − taxAmount` — si el neto no vino pero el IVA sí, el neto es
 *      derivable por resta exacta (el prompt pide `taxAmount = totalAmount −
 *      netAmount`). Preferir el total acá sería volver a meter el IVA en el
 *      costo teniendo el dato para no hacerlo.
 *   3. `totalAmount` — sin neto y sin IVA discriminado no hay nada que restar.
 *      Es el caso de la Factura C / ticket, donde el total ES el costo.
 *
 * ESTA FUNCIÓN NO SE TOCA. Es la corrección CL-01 tal cual quedó, y es la que
 * corre para toda empresa preexistente (todas quedaron en RESPONSABLE_INSCRIPTO
 * por el default de la migración). `tests/validaciones/ledger-condicion-iva.test.ts`
 * la compara contra un oráculo con la implementación anterior sobre una grilla
 * exhaustiva de entradas: si alguien la cambia, ese test se pone rojo.
 *
 * La resta se redondea a 4 decimales (la precisión de la columna) para que el
 * ruido del punto flotante no genere importes tipo 9999999.999999998.
 */
function pickCostAmountResponsableInscripto(ed: ExtractedData | null): number | null {
  const net = usableNumber(ed?.netAmount);
  if (net != null) return net;

  const total = usableNumber(ed?.totalAmount);
  if (total == null) return null;

  const tax = usableNumber(ed?.taxAmount);
  // El IVA tiene que ser una porción positiva del total; si no lo es, el dato
  // está roto (o el "impuesto" no es tal) y restarlo haría más daño que bien.
  if (tax != null && tax > 0 && tax < total) {
    return a4Decimales(total - tax);
  }
  return total;
}

/**
 * MONOTRIBUTO / EXENTO — el IVA no se recupera y por lo tanto ES costo. Es el
 * espejo exacto del caso anterior; el costo es el TOTAL. Prioridad:
 *
 *   1. `totalAmount` — el importe efectivamente pagado, IVA incluido. Para esta
 *      empresa, eso ES el costo de adquisición.
 *   2. `netAmount + taxAmount` — si el total no vino pero sí el neto y el IVA
 *      discriminado, el total es reconstruible por suma exacta. Quedarse con el
 *      neto acá dejaría afuera un impuesto que esta empresa nunca recupera.
 *   3. `netAmount` — sin total y sin IVA discriminado no hay nada que sumar. El
 *      neto es lo único que hay; el error, si existe, es por defecto y no por
 *      exceso.
 *
 * El IVA se exige positivo para sumarlo, por simetría con el caso RI: un
 * `taxAmount` en 0 o negativo es dato roto, no un impuesto.
 */
function pickCostAmountIvaEsCosto(ed: ExtractedData | null): number | null {
  const total = usableNumber(ed?.totalAmount);
  if (total != null) return total;

  const net = usableNumber(ed?.netAmount);
  if (net == null) return null;

  const tax = usableNumber(ed?.taxAmount);
  if (tax != null && tax > 0) return a4Decimales(net + tax);
  return net;
}

/** Despacha a la precedencia que corresponde a la condición de la empresa. */
function pickCostAmount(ed: ExtractedData | null, condicion: CondicionIva): number | null {
  return ivaEsCosto(condicion)
    ? pickCostAmountIvaEsCosto(ed)
    : pickCostAmountResponsableInscripto(ed);
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
  /**
   * Condición de la empresa dueña del documento (`Company.condicionIva`).
   *
   * Es un parámetro opcional y no una dependencia inyectada a propósito: este
   * módulo sigue siendo una función pura sobre el JSON de la IA, sin Prisma ni
   * repositorios adentro, y el único llamador real (`validaciones-service`) ya
   * carga la conexión de la entrada — le alcanza con pedir una columna más en
   * el `select` que ya hace. Omitirlo equivale a RESPONSABLE_INSCRIPTO, que es
   * el default de la columna: los llamadores viejos y los tests existentes
   * siguen midiendo exactamente lo mismo que antes.
   */
  condicionIva?: CondicionIva | null;
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
  const condicionIva = params.condicionIva ?? CONDICION_IVA_POR_DEFECTO;
  const amount = pickCostAmount(ed, condicionIva);

  // Sin monto positivo no hay línea de costo (va a carga manual).
  if (amount == null || !Number.isFinite(amount) || amount <= 0) return null;

  // Tope de seguridad: la columna es Decimal(18,4) → máximo 14 dígitos enteros.
  // Un monto absurdo (OCR roto) podría desbordar y romper la inserción; mejor
  // omitir la línea que arriesgar un error. Lo revisa el costista a mano.
  if (amount >= 1e14) return null;

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
    condicionIva,
  };
}
