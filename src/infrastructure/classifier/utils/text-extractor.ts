// src/infrastructure/classifier/utils/text-extractor.ts

/**
 * Extracts all numeric amounts from a text (Argentine format: 1.234,56 or 1234.56).
 */
export function extractAmounts(text: string): number[] {
  const matches = text.match(/\b\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?\b|\b\d+,\d{2}\b/g) ?? [];
  return matches
    .map((m) => parseFloat(m.replace(/\./g, '').replace(',', '.')))
    .filter((n) => !isNaN(n) && n > 0);
}

/**
 * Extracts the first plausible date from text.
 * Supports DD/MM/YYYY and YYYY-MM-DD formats.
 */
export function extractFirstDate(text: string): { day: number; month: number; year: number } | null {
  const dmyMatch = /\b(\d{2})\/(\d{2})\/(\d{4})\b/.exec(text);
  if (dmyMatch && dmyMatch[1] && dmyMatch[2] && dmyMatch[3]) {
    return { day: parseInt(dmyMatch[1]), month: parseInt(dmyMatch[2]), year: parseInt(dmyMatch[3]) };
  }
  const isoMatch = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(text);
  if (isoMatch && isoMatch[1] && isoMatch[2] && isoMatch[3]) {
    return { day: parseInt(isoMatch[3]), month: parseInt(isoMatch[2]), year: parseInt(isoMatch[1]) };
  }
  return null;
}

/**
 * Normalizes text for pattern matching: uppercase, remove excess whitespace,
 * normalize accented characters.
 */
export function normalizeText(text: string): string {
  return text
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
