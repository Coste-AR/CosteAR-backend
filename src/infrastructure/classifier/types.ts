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
  // Gastos (no-costo): NO son inventariables ni parte del costo unitario.
  // Según la cátedra, solo los costos de producción (MP, MOD, CIP) son "costo";
  // comercialización, administración y financiero son "gasto" y NO deben
  // mezclarse en COSTOS_INDIRECTOS (inflarían la tasa de prorrateo del CIP).
  | 'GASTO_COMERCIALIZACION'
  | 'GASTO_ADMINISTRACION'
  | 'GASTO_FINANCIERO'
  | 'MULTIPLE'
  | 'DESCONOCIDO';

/**
 * Subtipos de gasto (no-costo). Subconjunto de CostSection usado por el
 * routing y las señales transversales de gasto.
 */
export type GastoSubtype =
  | 'GASTO_COMERCIALIZACION'
  | 'GASTO_ADMINISTRACION'
  | 'GASTO_FINANCIERO';

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
 * Naturaleza de una merma / desperdicio, según la doctrina de costos.
 *
 * Es un EJE DE CLASIFICACIÓN GENERAL, deliberadamente desacoplado del método
 * de costeo (órdenes vs procesos): describe QUÉ es la merma, no CÓMO se absorbe.
 *
 * - NORMAL:        merma esperada/rutinaria, dentro del rango habitual. Se
 *                  absorbe en el costo de las unidades buenas → NO es pérdida.
 *                  (En procesos genera CAUO; en órdenes recarga el CIP/orden —
 *                  eso lo decide el módulo de costeo, no este eje.)
 * - EXTRAORDINARY: siniestro / evento anormal (incendio, robo, inundación,
 *                  deterioro total). Cae fuera del costo → pérdida en el Estado
 *                  de Resultados (PERDIDA_INVENTARIO).
 * - AMBIGUOUS:     hay lenguaje de merma pero no hay señal clara de su
 *                  naturaleza → no se asume ninguna, va a revisión humana.
 */
export type WasteNature = 'NORMAL' | 'EXTRAORDINARY' | 'AMBIGUOUS';

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
