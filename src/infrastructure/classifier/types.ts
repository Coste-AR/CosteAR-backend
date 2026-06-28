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
  | 'MULTIPLE'
  | 'DESCONOCIDO';

/**
 * Tipo de intención del mensaje del operario.
 * Un operario no solo manda documentos — también comunica eventos
 * de negocio, pérdidas, actualizaciones, correcciones, etc.
 */
export type InputIntent =
  | 'DOCUMENTO_FORMAL'      // Factura, remito, recibo con estructura reconocible
  | 'DOCUMENTO_INFORMAL'    // "llegó la factura de luz $50000" — descripción de un doc
  | 'EVENTO_NEGOCIO'        // "hay sequía", "clausuraron el local" — hecho del negocio
  | 'PERDIDA_INVENTARIO'    // "se quemó la carne", "se venció el stock"
  | 'EVENTO_LABORAL'        // "trabajaron 200hs extra", "paro sindical 3 días"
  | 'ACTUALIZACION_PRECIO'  // "el proveedor subió el insumo a $X"
  | 'CORRECCION'            // "el de ayer fue un error, el monto real era..."
  | 'CONSULTA'              // pregunta al costista
  | 'DESCONOCIDO';          // no se pudo determinar

/**
 * Categoría de industria de la empresa.
 * Determina qué es MP, MOD y CIP en ese contexto.
 */
export type IndustryCategory =
  | 'AGRO'           // cosecha, ganadería, tambo, vitivinicultura
  | 'GASTRONOMIA'    // restaurantes, panaderías, catering
  | 'MANUFACTURA'    // fábrica, producción industrial
  | 'CONSTRUCCION'   // obras civiles, arquitectura
  | 'TEXTIL'         // confección, indumentaria
  | 'SALUD'          // clínicas, farmacias, laboratorios
  | 'SERVICIOS'      // profesionales, consultoría, software
  | 'COMERCIO'       // minorista, mayorista, distribución
  | 'TRANSPORTE'     // fletes, logística
  | 'DEFAULT';       // industria no reconocida o no informada

export interface SignalResult {
  label: string;
  pts: number;
  type: string;
  layer: number;
}

export interface ClassifierInput {
  text: string;
  costistId: string;
  companyId: string;
  dataEntryId: string;
  supplierCuit?: string | null;
  // Nuevos campos v2
  industry?: string | null;         // industry libre de la empresa
  enrichedText?: string | null;     // texto enriquecido con OCR de Groq
  sourceType?: 'TEXT' | 'PDF' | 'IMAGE';
  extractedData?: Record<string, unknown> | null;  // datos estructurados de Groq
}

export interface ClassificationResult {
  documentType: DocumentType;
  costSection: CostSection;
  confidence: number;
  requiresReview: boolean;
  isDuplicate: boolean;
  duplicateEntryId?: string;
  qualityGate: 'PASS' | 'PARTIAL' | 'FAIL';
  definitiveSignal: string | null;
  signals: SignalResult[];
  aiUsed: boolean;
  supplierFingerprintUsed: boolean;
  confidenceCap: number | null;
  // Nuevos campos v2
  intent: InputIntent;
  industryCategory: IndustryCategory;
  explanation: string;              // explicación legible para el costista
}
