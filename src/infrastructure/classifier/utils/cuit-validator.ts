// src/infrastructure/classifier/utils/cuit-validator.ts

const WEIGHTS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2] as const;

/**
 * Validates an Argentine CUIT/CUIL number using the official AFIP verifier algorithm.
 * Accepts with or without hyphens. Returns false for any structural error.
 */
export function validateCuit(raw: string): boolean {
  const digits = raw.replace(/\D/g, '');
  if (digits.length !== 11) return false;

  const sum = WEIGHTS.reduce((acc, w, i) => acc + w * Number(digits[i]), 0);
  const remainder = sum % 11;

  // Remainder of 1 is structurally invalid per AFIP specification
  if (remainder === 1) return false;

  const expectedVerifier = remainder === 0 ? 0 : 11 - remainder;
  return Number(digits[10]) === expectedVerifier;
}

/**
 * Extracts all CUIT-formatted numbers from a text and returns the ones
 * that pass the verifier check, as 11-digit strings (no hyphens).
 */
export function extractCuits(text: string): string[] {
  // Matches XX-XXXXXXXX-X or XXXXXXXXXXX (11 consecutive digits)
  const formatted = text.match(/\d{2}-\d{8}-\d/g) ?? [];
  const raw = text.match(/(?<!\d)\d{11}(?!\d)/g) ?? [];

  const candidates = [
    ...formatted.map((c) => c.replace(/\D/g, '')),
    ...raw,
  ];

  // Deduplicate + filter valid
  return [...new Set(candidates)].filter(validateCuit);
}
