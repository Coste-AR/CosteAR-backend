// src/infrastructure/classifier/layers/layer0-quality-gate.ts

const MIN_SUBSTANTIVE_LENGTH = 20;

export interface QualityGateResult {
  gate: 'PASS' | 'PARTIAL' | 'FAIL';
  confidenceCap: number | null;
}

/**
 * Layer 0: Quality Gate.
 * - 'ilegible' → FAIL (skip classification)
 * - 'parcial' → PARTIAL, cap confidence at 65
 * - text shorter than MIN_SUBSTANTIVE_LENGTH → PARTIAL, cap at 65
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
    return { gate: 'PARTIAL', confidenceCap: 65 };
  }

  return { gate: 'PASS', confidenceCap: null };
}
