// src/infrastructure/classifier/signals/corroborating-signals.config.ts
import type { DocumentType } from '../types.js';

export interface CorroboratingSignal {
  label: string;
  pattern: RegExp;
  pts: number;
  type: DocumentType;
}

export interface ContradictionRule {
  if: string;
  and: string;
  penalty: number;
  reason: string;
  /**
   * Tipo de documento (hipótesis) que esta contradicción desacredita. La señal
   * `if` es la débil que queda refutada por la señal definitiva `and`; por eso
   * `penalizes` es el tipo asociado a `if`. La penalización se resta SOLO a este
   * tipo, no a todos: restar a todos hundía también al tipo probablemente
   * correcto (p. ej. FACTURA_COMPRA) y empujaba casos claros a revisión humana.
   */
  penalizes: DocumentType;
}

export const CORROBORATING_SIGNALS: CorroboratingSignal[] = [
  // ── Factura indicators ─────────────────────────────────────────────────────
  { label: 'CUIT_FORMAT',      pattern: /\d{2}-\d{8}-\d/,                               pts: 12, type: 'FACTURA_COMPRA' },
  { label: 'PTO_VENTA_HEADER', pattern: /\bPUNTO\s+DE\s+VENTA\b/i,                     pts: 15, type: 'FACTURA_COMPRA' },
  { label: 'COMP_NRO',         pattern: /\bCOMP\.\s*NRO\b|\bN[ÚU]MERO\s+DE\s+COMPROBANTE\b/i, pts: 10, type: 'FACTURA_COMPRA' },
  { label: 'IB_FIELD',         pattern: /\bINGRESOS\s+BRUTOS\b/i,                       pts: 8,  type: 'FACTURA_COMPRA' },
  { label: 'INICIO_ACT',       pattern: /\bINICIO\s+DE\s+ACTIVIDADES\b/i,               pts: 8,  type: 'FACTURA_COMPRA' },
  { label: 'IVA_CONDITION',    pattern: /\bCONDICI[OÓ]N\s+FRENTE\s+AL\s+IVA\b/i,      pts: 10, type: 'FACTURA_COMPRA' },
  // ── MOD indicators ─────────────────────────────────────────────────────────
  { label: 'ANSES',            pattern: /\bANSES\b/i,                                   pts: 20, type: 'LIQUIDACION_MOD' },
  { label: 'OBRA_SOCIAL',      pattern: /\bOBRA\s+SOCIAL\b/i,                           pts: 18, type: 'LIQUIDACION_MOD' },
  { label: 'CUIL_KEYWORD',     pattern: /\bCUIL\b/,                                     pts: 15, type: 'LIQUIDACION_MOD' },
  { label: 'JUBILACION',       pattern: /\bJUBILACI[OÓ]N\b|\bJUBILATORIO\b/i,          pts: 18, type: 'LIQUIDACION_MOD' },
  { label: 'ART',              pattern: /\bART\b.*\baccidente\b|\baccidente\b.*\bART\b/i, pts: 15, type: 'LIQUIDACION_MOD' },
  { label: 'SUELDO_BASICO',    pattern: /\bSUELDO\s+B[AÁ]SICO\b|\bREMUNERACI[OÓ]N\s+B[AÁ]SICA\b/i, pts: 20, type: 'LIQUIDACION_MOD' },
  { label: 'HORAS_WORKED',     pattern: /\bHORAS\s+(EXTRA|TRABAJADAS|NORMALES)\b/i,     pts: 15, type: 'LIQUIDACION_MOD' },
  // ── Planilla de horas indicators ────────────────────────────────────────────
  { label: 'DEPT_HOURS',       pattern: /\bDEPARTAMENTO\b.*\bHORAS\b|\bHORAS\b.*\bDEPARTAMENTO\b/i, pts: 25, type: 'PLANILLA_HORAS' },
  { label: 'TURNO_JORNADA',    pattern: /\bTURNO\b.*\bJORNADA\b|\bJORNADA\b.*\bTURNO\b/i, pts: 20, type: 'PLANILLA_HORAS' },
  { label: 'HOURS_FORMAT',     pattern: /\bHs?\.\s*\d+[.,]\d{2}\b/,                    pts: 15, type: 'PLANILLA_HORAS' },
  // ── Remito indicators ───────────────────────────────────────────────────────
  { label: 'REMITO_KEYWORD',   pattern: /\bREMITO\b/i,                                  pts: 25, type: 'REMITO' },
  { label: 'FECHA_ENTREGA',    pattern: /\bFECHA\s+DE\s+(ENTREGA|REMISI[OÓ]N)\b/i,     pts: 18, type: 'REMITO' },
  { label: 'TRANSPORTE',       pattern: /\bTRANSPORTISTA\b|\bCHOFER\b/i,               pts: 15, type: 'REMITO' },
];

export const CONTRADICTIONS: ContradictionRule[] = [
  // REMITO_KEYWORD (tipo REMITO) + CAE_FOUND: un remito no lleva CAE, así que la
  // presencia del CAE refuta la hipótesis REMITO. Penaliza solo a REMITO.
  { if: 'REMITO_KEYWORD', and: 'CAE_FOUND', penalty: -30, reason: 'Remito no puede tener CAE', penalizes: 'REMITO' },
  // ANSES (tipo LIQUIDACION_MOD) + PTO_VENTA_HEADER: una liquidación no tiene
  // punto de venta; el PtoVta refuta la hipótesis de liquidación. Penaliza solo
  // a LIQUIDACION_MOD.
  { if: 'ANSES', and: 'PTO_VENTA_HEADER', penalty: -25, reason: 'Liquidación no tiene PtoVta', penalizes: 'LIQUIDACION_MOD' },
  // CUIL_KEYWORD (tipo LIQUIDACION_MOD) + CAE_FOUND: un CUIL en un documento con
  // CAE (factura real) es inusual; debilita la hipótesis de liquidación, no la
  // de factura. Penaliza solo a LIQUIDACION_MOD.
  { if: 'CUIL_KEYWORD', and: 'CAE_FOUND', penalty: -15, reason: 'CUIL inusual en factura con CAE', penalizes: 'LIQUIDACION_MOD' },
];
