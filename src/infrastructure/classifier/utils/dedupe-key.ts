// src/infrastructure/classifier/utils/dedupe-key.ts

/**
 * Datos extraídos por la IA relevantes para deduplicación.
 */
export interface DedupeSource {
  supplier?: string | null;
  invoiceNumber?: string | null;
  totalAmount?: number | null;
  date?: string | null;
}

/** Normaliza un texto: minúsculas, sin tildes, sin espacios/símbolos extra. */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // saca tildes
    .replace(/[^a-z0-9]/g, '');      // solo alfanumérico
}

/**
 * Clave FUERTE de deduplicación: proveedor + número de comprobante.
 *
 * Solo se genera cuando ambos están presentes. Es confiable porque en
 * Argentina el número de comprobante (punto de venta + número) es único por
 * proveedor → dos envíos con la misma clave son el mismo documento.
 *
 * Devuelve null si falta cualquiera de los dos (no inventamos duplicados:
 * sin clave fuerte preferimos dejar pasar a que el costista decida).
 */
export function buildStrongDedupeKey(src: DedupeSource): string | null {
  const supplier = src.supplier ? normalize(src.supplier) : '';
  const invoice  = src.invoiceNumber ? normalize(src.invoiceNumber) : '';
  if (supplier.length < 2 || invoice.length < 2) return null;
  return `${supplier}|${invoice}`;
}
