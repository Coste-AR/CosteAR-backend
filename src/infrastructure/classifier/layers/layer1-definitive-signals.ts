import { DEFINITIVE_SIGNALS } from '../signals/definitive-signals.config.js';
import type { DocumentType } from '../types.js';

export interface Layer1Result {
  label: string;
  documentType: DocumentType;
  confidence: number;
}

/**
 * Layer 1: Definitive Signals.
 * Scans for AFIP/ARCA hardcoded legal markers. A single match sets document
 * type with high confidence and skips Layers 2-3.
 * Returns null if no definitive signal is found.
 * When multiple signals match, returns the highest-confidence one.
 */
export function runLayer1(text: string): Layer1Result | null {
  const candidates: Layer1Result[] = [];

  for (const signal of DEFINITIVE_SIGNALS) {
    if (!signal.pattern.test(text)) continue;
    if (signal.excludeIfPattern && signal.excludeIfPattern.test(text)) continue;
    if (signal.requiresPattern && !signal.requiresPattern.test(text)) continue;

    candidates.push({
      label: signal.label,
      documentType: signal.documentType,
      confidence: signal.confidence,
    });
  }

  if (candidates.length === 0) return null;

  return candidates.reduce((best, curr) => curr.confidence > best.confidence ? curr : best);
}
