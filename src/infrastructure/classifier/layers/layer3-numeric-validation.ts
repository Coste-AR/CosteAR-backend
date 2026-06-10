import { validateCuit } from '../utils/cuit-validator.js';
import { validateCAEStructure } from '../utils/cae-validator.js';
import { extractFirstDate } from '../utils/text-extractor.js';

/**
 * Layer 3: Numeric Structural Validation.
 * Returns a delta (+/-) to apply to the current confidence score.
 * Does NOT classify on its own — only confirms or penalizes.
 */
export function runLayer3(text: string): number {
  let delta = 0;

  // ── CUIT validation ────────────────────────────────────────────────────────
  const cuitMatches = text.match(/\d{2}-\d{8}-\d/g) ?? [];
  const rawCuitMatches = text.match(/(?<!\d)\d{11}(?!\d)/g) ?? [];
  const allCandidates = [
    ...cuitMatches.map((c) => c.replace(/\D/g, '')),
    ...rawCuitMatches,
  ];

  if (allCandidates.length > 0) {
    const validCount = allCandidates.filter(validateCuit).length;
    if (validCount > 0) {
      delta += 10;
    } else {
      delta -= 15;
    }
  }

  // ── CAE validation ─────────────────────────────────────────────────────────
  const caePattern = /\bCAE\s*N?[°º]?\s*:?\s*(\d+)\b/i;
  const caeRaw = caePattern.exec(text);
  if (caeRaw && caeRaw[1]) {
    const digits = caeRaw[1];
    if (validateCAEStructure(digits)) {
      delta += 12;
    } else {
      delta -= 20;
    }
  }

  // ── Date reasonableness ────────────────────────────────────────────────────
  const date = extractFirstDate(text);
  if (date) {
    const currentYear = new Date().getFullYear();
    if (date.year >= currentYear - 10 && date.year <= currentYear + 1) {
      delta += 5;
    } else {
      delta -= 10;
    }
  }

  return delta;
}
