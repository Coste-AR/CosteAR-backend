// src/infrastructure/classifier/signals/definitive-signals.config.ts
import type { DocumentType } from '../types.js';

export interface DefinitiveSignal {
  label: string;
  pattern: RegExp;
  documentType: DocumentType;
  confidence: number;
  requiresPattern?: RegExp;
  excludeIfPattern?: RegExp;
}

export const DEFINITIVE_SIGNALS: DefinitiveSignal[] = [
  {
    label: 'CAE_FOUND',
    pattern: /\bCAE\s*N?[°º]?\s*:?\s*\d{14}\b/i,
    documentType: 'FACTURA_COMPRA',
    confidence: 97,
  },
  {
    label: 'FACTURA_ABC',
    pattern: /\bFACTURA\s+[ABC]\b/i,
    documentType: 'FACTURA_COMPRA',
    confidence: 94,
    requiresPattern: /\d{2}-\d{8}-\d|\b\d{11}\b/,
  },
  {
    label: 'NOTA_DEBITO_ABC',
    pattern: /\bNOTA\s+DE\s+D[EÉ]BITO\s+[ABC]\b/i,
    documentType: 'NOTA_DEBITO',
    confidence: 96,
  },
  {
    label: 'NOTA_CREDITO_ABC',
    pattern: /\bNOTA\s+DE\s+CR[EÉ]DITO\s+[ABC]\b/i,
    documentType: 'NOTA_CREDITO',
    confidence: 96,
  },
  {
    label: 'RECIBO_SUELDO',
    pattern: /\bRECIBO\s+DE\s+SUELDO\b|\bLIQUIDACI[OÓ]N\s+DE\s+HABERES\b/i,
    documentType: 'LIQUIDACION_MOD',
    confidence: 98,
  },
  {
    label: 'REMITO_HEADER',
    pattern: /^\s*R[\s.]?E[\s.]?M[\s.]?I[\s.]?T[\s.]?O\b/im,
    documentType: 'REMITO',
    confidence: 93,
    excludeIfPattern: /\bCAE\s*N?[°º]?\s*:?\s*\d{14}\b/i,
  },
];
