// src/infrastructure/classifier/utils/cae-validator.ts

const CAE_PATTERN = /\bCAE\s*N?[°º]?\s*:?\s*(\d{14})\b/i;

/**
 * Validates that a string is exactly 14 numeric digits and is not all zeros.
 */
export function validateCAEStructure(cae: string): boolean {
  if (!/^\d{14}$/.test(cae)) return false;
  if (cae === '00000000000000') return false;
  return true;
}

/**
 * Extracts a CAE from text using AFIP-standard label patterns.
 * Returns the 14-digit string or null.
 */
export function extractCAE(text: string): string | null {
  const match = CAE_PATTERN.exec(text);
  if (!match || !match[1]) return null;
  return validateCAEStructure(match[1]) ? match[1] : null;
}
