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
  | 'AVICULTURA'     // postura de huevo, granjas avícolas
  | 'GASTRONOMIA'    // restaurantes, panaderías, catering
  | 'MANUFACTURA'    // fábrica, producción industrial
  | 'CONSTRUCCION'   // obras civiles, arquitectura
  | 'TEXTIL'         // confección, indumentaria
  | 'SALUD'          // clínicas, farmacias, laboratorios
  | 'SERVICIOS'      // profesionales, consultoría, software
  | 'COMERCIO'       // minorista, mayorista, distribución
  | 'TRANSPORTE'     // fletes, logística
  | 'DEFAULT';       // industria no reconocida o no informada

/**
 * Vínculo declarado por un flete/seguro/acarreo facturado APARTE hacia la compra
 * cuyo costo de adquisición integra (R-ADQUISICION, Clase 4, ll. 15-18).
 *
 * ─── QUÉ RESUELVE EL CLASIFICADOR Y QUÉ LE QUEDA A LA APLICACIÓN ─────────────
 *
 * El clasificador resuelve LA SECCIÓN, porque la sección sale del texto del
 * propio comprobante: si el papel dice "flete por la compra de 38 t de maíz",
 * ese flete es costo de adquisición de una materia prima, exista o no la otra
 * factura en el sistema. Se imputa MATERIA_PRIMA de forma determinista.
 *
 * Lo que el clasificador NO puede resolver es a QUÉ ASIENTO se acumula el
 * importe: eso exige buscar `referencedComprobante` en el libro de la empresa,
 * una consulta scopeada por costista/empresa. Es de la capa de aplicación.
 *
 * ─── CONTRATO PARA LA CAPA DE APLICACIÓN (ledger) ────────────────────────────
 *
 * Cuando este campo viene presente, el libro debería:
 *
 *  1. Buscar el comprobante referenciado entre los documentos ya cargados de la
 *     empresa (la clave existe: `DataEntry.dedupeKey` = proveedor|nro normalizado,
 *     y `extractedData.invoiceNumber` guarda el número de cada comprobante).
 *  2. SI LO ENCUENTRA: acumular este importe sobre el costo de adquisición de esa
 *     compra, en vez de dejarlo como una línea suelta de Materia Prima.
 *  3. SI NO LO ENCUENTRA —el caso normal, porque el flete llega antes o después
 *     que la mercadería—: **NO reclasificar a Costos Indirectos y NO frenar el
 *     documento**. El importe queda imputado a la sección que decidió el
 *     clasificador y el vínculo queda PENDIENTE, para resolverse cuando llegue el
 *     comprobante que falta (en cualquiera de los dos órdenes de llegada).
 *  4. Si el vínculo sigue pendiente al cerrar el período, ahí sí escalarlo al
 *     costista como un pendiente explícito — nunca resolverlo en silencio.
 *
 * El punto 3 es la decisión de fondo: **el orden en que llega el papel no puede
 * cambiar la naturaleza contable del gasto**. Mandarlo a CIP "mientras tanto" es
 * exactamente el error que esta corrección arregla, solo que disfrazado de
 * default temporal, y encima es el error caro (un CIP mal cargado infla la tasa
 * de prorrateo de TODAS las unidades del período, no solo de este lote).
 */
export interface AcquisitionCostLink {
  /**
   * Comprobante de la compra que este flete/seguro integra, normalizado a la
   * forma canónica argentina PPPP-NNNNNNNN.
   *
   * null cuando el documento declara que el flete es sobre una compra pero no
   * cita el número (o el OCR no lo pudo leer): la sección se decide igual, y lo
   * único que falta es a qué compra se acumula.
   */
  referencedComprobante: string | null;
  /** La frase del propio comprobante que declara el vínculo. Trazabilidad. */
  declaredBy: string;
}

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
  /**
   * Presente solo cuando el documento declara ser un flete/seguro sobre una
   * compra. Ver el contrato completo en `AcquisitionCostLink`. Es opcional a
   * propósito: la capa de aplicación que todavía no lo consume sigue compilando
   * y sigue funcionando igual que antes.
   */
  acquisitionLink?: AcquisitionCostLink | null;
}
