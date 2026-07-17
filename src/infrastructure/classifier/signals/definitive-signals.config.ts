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
    // Factura de VENTA emitida por la empresa. Una factura de venta también
    // lleva CAE, así que sin este marcador el sistema la confundía con una
    // compra y la ruteaba a Materia Prima. Requiere contexto explícito de venta
    // ("venta a cliente", "vendimos", "factura de venta", "cliente: ...").
    label: 'FACTURA_VENTA_CTX',
    pattern: /\bfactura\b/i,
    documentType: 'FACTURA_VENTA',
    confidence: 98,
    // Marcadores INEQUÍVOCOS de venta emitida. Evitamos keys ambiguas como
    // "cliente" o "punto de venta" que también aparecen en facturas de COMPRA
    // (en una compra, nuestra empresa figura como "Cliente" del proveedor).
    requiresPattern: /\bfactura\s+[abc]?\s*de\s+venta\b|\bventa\s+a\s+cliente\b|\bvendimos\b|\bnota\s+de\s+venta\b/i,
  },
  {
    label: 'CAE_FOUND',
    pattern: /\bCAE\s*N?[°º]?\s*:?\s*\d{14}\b/i,
    documentType: 'FACTURA_COMPRA',
    confidence: 97,
    // Si el texto tiene contexto claro de venta, no es una compra.
    excludeIfPattern: /\bfactura\s+[abc]?\s*de\s+venta\b|\bventa\s+a\s+cliente\b|\bvendimos\b|\bnota\s+de\s+venta\b/i,
  },
  {
    label: 'FACTURA_ABC',
    pattern: /\bFACTURA\s+[ABC]\b/i,
    documentType: 'FACTURA_COMPRA',
    confidence: 94,
    requiresPattern: /\d{2}-\d{8}-\d|\b\d{11}\b/,
  },
  {
    // Confianza > CAE_FOUND (97): una nota de débito real TAMBIÉN lleva CAE, y
    // "NOTA DE DÉBITO A" es más específico que un CAE suelto. Sin esto, la nota
    // se leía como FACTURA_COMPRA y la regla nota→CIP nunca disparaba.
    label: 'NOTA_DEBITO_ABC',
    pattern: /\bNOTA\s+DE\s+D[EÉ]BITO\s+[ABC]\b/i,
    documentType: 'NOTA_DEBITO',
    confidence: 98,
  },
  {
    label: 'NOTA_CREDITO_ABC',
    pattern: /\bNOTA\s+DE\s+CR[EÉ]DITO\s+[ABC]\b/i,
    documentType: 'NOTA_CREDITO',
    confidence: 98,
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
