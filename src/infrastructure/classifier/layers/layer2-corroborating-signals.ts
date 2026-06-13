import { CORROBORATING_SIGNALS, CONTRADICTIONS } from '../signals/corroborating-signals.config.js';
import type { DocumentType, SignalResult } from '../types.js';

export interface Layer2Result {
  signals: SignalResult[];
  totalPts: number;
  winningType: DocumentType | null;
  scoreByType: Record<string, number>;
  /** Segundo tipo con más puntaje (si existe). */
  runnerUpType: DocumentType | null;
  /** Puntaje del segundo tipo. */
  runnerUpPts: number;
  /** Diferencia de puntaje entre el ganador y el segundo. */
  margin: number;
  /**
   * true cuando hay un segundo candidato real y el margen con el ganador
   * es menor a AMBIGUITY_MARGIN. Señala que el puntaje absoluto del ganador
   * no alcanza para confiar: dos tipos quedaron peleados.
   */
  ambiguous: boolean;
}

/**
 * Margen mínimo de puntos entre el tipo ganador y el segundo para considerar
 * la clasificación inequívoca. Por debajo de esto, dos tipos están demasiado
 * cerca → es un caso ambiguo que debe desempatar la IA o el humano.
 */
export const AMBIGUITY_MARGIN = 15;

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

  // Ordenar tipos por puntaje descendente para extraer ganador y segundo.
  const ranked = Object.entries(scoreByType)
    .filter(([, pts]) => pts > 0)
    .sort((a, b) => b[1] - a[1]);

  const winningType = (ranked[0]?.[0] ?? null) as DocumentType | null;
  const totalPts = ranked[0]?.[1] ?? 0;

  const runnerUpType = (ranked[1]?.[0] ?? null) as DocumentType | null;
  const runnerUpPts = ranked[1]?.[1] ?? 0;

  const margin = winningType ? totalPts - runnerUpPts : 0;
  const ambiguous = runnerUpType !== null && margin < AMBIGUITY_MARGIN;

  return {
    signals: allSignals,
    totalPts,
    winningType,
    scoreByType,
    runnerUpType,
    runnerUpPts,
    margin,
    ambiguous,
  };
}
