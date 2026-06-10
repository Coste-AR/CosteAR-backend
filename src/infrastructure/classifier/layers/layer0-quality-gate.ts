// src/infrastructure/classifier/layers/layer0-quality-gate.ts

const MIN_SUBSTANTIVE_LENGTH = 20;

/**
 * Confidence cap para calidad parcial.
 * El threshold efectivo se adapta al cap: si el cap es 65, el threshold
 * de auto-aprobación también baja a 65 (no tiene sentido exigir 72 y luego
 * capear en 65 → el doc nunca pasaría aunque tenga señales fuertes).
 */
export const PARTIAL_CONFIDENCE_CAP = 65;

export interface QualityGateResult {
  gate: 'PASS' | 'PARTIAL' | 'FAIL';
  confidenceCap: number | null;
}

/**
 * Layer 0: Quality Gate.
 * - 'ilegible' → FAIL (skip classification)
 * - 'parcial' → PARTIAL, cap confidence at PARTIAL_CONFIDENCE_CAP
 * - text shorter than MIN_SUBSTANTIVE_LENGTH → PARTIAL, cap at PARTIAL_CONFIDENCE_CAP
 * - otherwise → PASS
 */
export function runQualityGate(input: {
  quality: 'legible' | 'parcial' | 'ilegible' | null;
  text: string;
}): QualityGateResult {
  if (input.quality === 'ilegible') {
    return { gate: 'FAIL', confidenceCap: null };
  }

  if (input.quality === 'parcial' || input.text.trim().length < MIN_SUBSTANTIVE_LENGTH) {
    return { gate: 'PARTIAL', confidenceCap: PARTIAL_CONFIDENCE_CAP };
  }

  return { gate: 'PASS', confidenceCap: null };
}
