// src/infrastructure/classifier/types.ts

export type DocumentType =
  | 'FACTURA_COMPRA'
  | 'FACTURA_VENTA'
  | 'REMITO'
  | 'LIQUIDACION_MOD'
  | 'PLANILLA_HORAS'
  | 'NOTA_DEBITO'
  | 'NOTA_CREDITO'
  | 'DESCONOCIDO';

export type CostSection =
  | 'MATERIA_PRIMA'
  | 'MANO_DE_OBRA'
  | 'COSTOS_INDIRECTOS'
  | 'VENTAS'
  | 'DESCONOCIDO';

export interface SignalResult {
  label: string;       // e.g. 'CAE_FOUND', 'ANSES', 'CUIT_FORMAT'
  pts: number;         // points contributed (negative for penalties)
  type: string;        // which document type this signal supports
  layer: number;       // 1, 2, or 3
}

export interface ClassifierInput {
  text: string;                     // raw text content (OCR or user-typed)
  costistId: string;
  companyId: string;
  dataEntryId: string;
  supplierCuit?: string | null;     // pre-extracted CUIT if available
}

export interface ClassificationResult {
  documentType: DocumentType;
  costSection: CostSection;
  confidence: number;               // 0-100
  requiresReview: boolean;          // true if confidence < 72
  isDuplicate: boolean;
  duplicateEntryId?: string;        // filled if isDuplicate
  qualityGate: 'PASS' | 'PARTIAL' | 'FAIL';
  definitiveSignal: string | null;
  signals: SignalResult[];
  aiUsed: boolean;
  supplierFingerprintUsed: boolean;
  confidenceCap: number | null;     // 65 if quality is partial
}
