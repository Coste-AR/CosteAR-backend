import { CORROBORATING_SIGNALS, CONTRADICTIONS } from '../signals/corroborating-signals.config.js';
import type { DocumentType, SignalResult } from '../types.js';

export interface Layer2Result {
  signals: SignalResult[];
  totalPts: number;
  winningType: DocumentType | null;
  scoreByType: Record<string, number>;
}

/**
 * Layer 2: Corroborating signals with weighted accumulation.
 * Scans text against secondary signals, accumulates points by type.
 * Applies contradiction penalties between co-occurring signals.
 *
 * @param text - raw document text
 * @param extraFoundLabels - labels already found in Layer 1 (for contradiction checking)
 */
export function runLayer2(text: string, extraFoundLabels: string[] = []): Layer2Result {
  const foundSignals: SignalResult[] = [];
  const foundLabels: Set<string> = new Set(extraFoundLabels);

  for (const signal of CORROBORATING_SIGNALS) {
    if (signal.pattern.test(text)) {
      foundSignals.push({ label: signal.label, pts: signal.pts, type: signal.type, layer: 2 });
      foundLabels.add(signal.label);
    }
  }

  const penalties: SignalResult[] = [];
  for (const rule of CONTRADICTIONS) {
    if (foundLabels.has(rule.if) && foundLabels.has(rule.and)) {
      penalties.push({ label: `CONTRADICTION:${rule.if}+${rule.and}`, pts: rule.penalty, type: '', layer: 2 });
    }
  }

  const allSignals = [...foundSignals, ...penalties];

  // Sum points by type
  const scoreByType: Record<string, number> = {};
  for (const signal of foundSignals) {
    scoreByType[signal.type] = (scoreByType[signal.type] ?? 0) + signal.pts;
  }
  // Penalties reduce all types proportionally (simplification: reduce winning type)
  for (const penalty of penalties) {
    for (const type of Object.keys(scoreByType)) {
      scoreByType[type] = (scoreByType[type] ?? 0) + penalty.pts;
    }
  }

  const entries = Object.entries(scoreByType).filter(([, pts]) => pts > 0);
  const winner = entries.length > 0
    ? entries.reduce((best, curr) => curr[1] > best[1] ? curr : best)
    : null;

  const winningType = (winner?.[0] ?? null) as DocumentType | null;
  const totalPts = winner?.[1] ?? 0;

  return { signals: allSignals, totalPts, winningType, scoreByType };
}
