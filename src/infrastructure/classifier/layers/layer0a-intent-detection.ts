// src/infrastructure/classifier/layers/layer0a-intent-detection.ts
import type { InputIntent, IndustryCategory } from '../types.js';
import type { IndustryProfile } from '../industry/industry-profile.js';

export interface IntentResult {
  intent: InputIntent;
  confidence: number;  // 0-100, qué tan seguro estamos del intent
  signals: string[];   // señales que dispararon esta clasificación
}

// ── Señales de documentos formales ───────────────────────────────────────────

const FORMAL_DOC_SIGNALS: { pattern: RegExp; signal: string }[] = [
  { pattern: /\bCAE\s*N?[°º]?\s*:?\s*\d{14}\b/i,              signal: 'CAE detectado' },
  { pattern: /\b\d{2}-\d{8}-\d\b/,                            signal: 'CUIT/CUIL detectado' },
  { pattern: /\bfactura\s+[A-C]\b/i,                          signal: 'Tipo de factura' },
  { pattern: /\bpunto\s+de\s+venta\b|\bpto\.?\s*vta\b/i,      signal: 'Punto de venta' },
  { pattern: /\bcomprobante\s+N?[°º]?\s*\d+/i,                signal: 'Número de comprobante' },
  { pattern: /\bIVA\s+\d+%/i,                                  signal: 'IVA porcentaje' },
  { pattern: /\bremito\s+N?[°º]?\s*\d+/i,                     signal: 'Número de remito' },
  { pattern: /\brecibo\s+N?[°º]?\s*\d+/i,                     signal: 'Número de recibo' },
  { pattern: /\bnota\s+de\s+débito\b|\bnota\s+de\s+credito\b/i, signal: 'Nota de débito/crédito' },
];

// ── Señales de documento informal (el operario describe un doc) ───────────────

const INFORMAL_DOC_SIGNALS: { pattern: RegExp; signal: string }[] = [
  { pattern: /\bllegó\s+(la|el|una?)\s+(factura|boleta|cuenta|remito|nota)\b/i, signal: 'Llegó documento' },
  { pattern: /\bpagamos?\s+\$[\d.,]+/i,                        signal: 'Pago mencionado' },
  { pattern: /\babonamos?\s+\$[\d.,]+/i,                       signal: 'Abono mencionado' },
  { pattern: /\bfactura\s+de\s+\w+/i,                         signal: 'Factura de servicio' },
  { pattern: /\bcuenta\s+de\s+(luz|gas|agua|internet)/i,       signal: 'Cuenta de servicio' },
  { pattern: /\$[\d.,]+\s*(pesos?|ars)?/i,                     signal: 'Monto en pesos' },
];

// ── Señales de evento de negocio (natural/externo) ────────────────────────────

const BUSINESS_EVENT_SIGNALS: { pattern: RegExp; signal: string }[] = [
  // Agro
  { pattern: /\bsequía\b|\bsequia\b/i,                         signal: 'Sequía' },
  { pattern: /\bgranizo\b/i,                                    signal: 'Granizo' },
  { pattern: /\bhelada\b/i,                                     signal: 'Helada' },
  { pattern: /\binundaci[oó]n\b/i,                              signal: 'Inundación' },
  { pattern: /\bplaga\b/i,                                      signal: 'Plaga' },
  { pattern: /\bcosecha\s+(frustrada|perdida|fallida)/i,        signal: 'Cosecha perdida' },
  { pattern: /\bno\s+(hubo|habrá)\s+producci[oó]n\b/i,        signal: 'Sin producción' },
  { pattern: /\bcampo\s+anegado\b/i,                           signal: 'Campo anegado' },
  // Clausuras y habilitaciones
  { pattern: /\bclausura(ron)?\b/i,                             signal: 'Clausura' },
  { pattern: /\bhabilitaci[oó]n\s+vencida\b/i,                 signal: 'Habilitación vencida' },
  { pattern: /\binspecci[oó]n\b.{0,30}(multa|sanción|cierre)/i, signal: 'Inspección con sanción' },
  { pattern: /\bmunicipio\s+par[oó]\b/i,                       signal: 'Municipio paró' },
  // Cortes de servicios
  { pattern: /\bcorte\s+de\s+(luz|gas|agua)\b/i,               signal: 'Corte de servicio' },
  { pattern: /\bpar[oó]\s+(la\s+)?(planta|producción|máquina|obra)\b/i, signal: 'Parada de producción' },
  // Paros laborales
  { pattern: /\bparo\s+sindical\b|\bhuelga\b|\block.?out\b/i,  signal: 'Conflicto laboral' },
];

// ── Señales de pérdida de inventario ─────────────────────────────────────────

const LOSS_SIGNALS: { pattern: RegExp; signal: string }[] = [
  { pattern: /\bse\s+(quemó|incendió)\b.{0,50}/i,             signal: 'Quema/incendio' },
  { pattern: /\bse\s+(perdió|estropeó|dañó|pudrió)\b/i,       signal: 'Pérdida de material' },
  { pattern: /\bse\s+(venció|venci[oó])\b/i,                   signal: 'Vencimiento' },
  { pattern: /\bmerma\b|\bdesperdicio\b|\bscrap\b/i,           signal: 'Merma/desperdicio' },
  { pattern: /\bproducto\s+defectuoso\b/i,                     signal: 'Defecto de calidad' },
  { pattern: /\bincendio\b.{0,30}(local|planta|depósito)/i,   signal: 'Incendio' },
  { pattern: /\brobo\b|\bhurto\b|\basalto\b/i,                 signal: 'Robo/hurto' },
  { pattern: /\bcorte\s+de\s+frío\b|\bfalla\s+cadena\s+de\s+frío\b/i, signal: 'Ruptura cadena frío' },
];

// ── Señales de evento laboral ─────────────────────────────────────────────────

const LABOR_EVENT_SIGNALS: { pattern: RegExp; signal: string }[] = [
  { pattern: /\btrabajaron?\s+\d+\s*h(oras?|s\.?)\s*(extra|adicional)/i, signal: 'Horas extra' },
  { pattern: /\bpersonal\s+trabaj[oó]\s+\d+\s*h/i,            signal: 'Horas trabajadas' },
  { pattern: /\baccidente\s+(laboral|de\s+trabajo|en\s+obra)\b/i, signal: 'Accidente laboral' },
  { pattern: /\benfermedad\s+laboral\b/i,                       signal: 'Enfermedad laboral' },
  { pattern: /\bvacaciones\b.{0,30}personal\b/i,               signal: 'Vacaciones' },
];

// ── Señales de corrección ─────────────────────────────────────────────────────

const CORRECTION_SIGNALS: { pattern: RegExp; signal: string }[] = [
  { pattern: /\bel\s+(de\s+ayer|anterior|que\s+mandé)\s+(fue|era)\s+(un\s+)?error/i, signal: 'Corrección de entrada previa' },
  { pattern: /\bcorregir\b|\bactualizar\b.{0,30}anterior/i,   signal: 'Solicitud de corrección' },
  { pattern: /\bel\s+monto\s+real\s+era\b/i,                  signal: 'Corrección de monto' },
  { pattern: /\bel\s+total\s+correcto\b/i,                     signal: 'Corrección de total' },
];

// ── Señales de consulta ───────────────────────────────────────────────────────

const QUERY_SIGNALS: { pattern: RegExp; signal: string }[] = [
  { pattern: /\?/,                                             signal: 'Pregunta' },
  { pattern: /\bcuánto\b|\bcomo\s+va\b|\bcuál\s+es\b/i,       signal: 'Consulta de dato' },
  { pattern: /\bpodés\s+decirme\b|\bme\s+podés\s+aclarar\b/i, signal: 'Solicitud de aclaración' },
];

// ── Señales de actualización de precio ───────────────────────────────────────

const PRICE_UPDATE_SIGNALS: { pattern: RegExp; signal: string }[] = [
  { pattern: /\bsubió\s+el\s+precio\b|\baumentó\s+el\s+precio\b/i, signal: 'Aumento de precio' },
  { pattern: /\bnuevo\s+precio\s+de\b/i,                       signal: 'Nuevo precio' },
  { pattern: /\bactualiz[oó]\s+(el\s+)?precio\b/i,             signal: 'Actualización de precio' },
  { pattern: /\bel\s+proveedor\s+subió\b/i,                    signal: 'Proveedor aumentó' },
];

// ── Función principal ─────────────────────────────────────────────────────────

/**
 * Layer 0A: Detección de intención.
 * Corre ANTES del clasificador de cascada.
 * Para archivos (IMAGE/PDF), asume DOCUMENTO_FORMAL y lo verifica con Groq.
 * Para texto libre, aplica reglas deterministas.
 */
export function detectIntent(
  text: string,
  sourceType: 'TEXT' | 'PDF' | 'IMAGE' = 'TEXT',
  profile?: IndustryProfile,
): IntentResult {

  // Archivos siempre son documentos (formales hasta que se pruebe lo contrario)
  if (sourceType === 'IMAGE' || sourceType === 'PDF') {
    return { intent: 'DOCUMENTO_FORMAL', confidence: 80, signals: ['Archivo adjunto'] };
  }

  // Texto muy corto o vacío
  if (!text || text.trim().length < 5) {
    return { intent: 'DESCONOCIDO', confidence: 0, signals: [] };
  }

  const signals: string[] = [];

  // Puntajes acumulados por tipo
  let formalPts   = 0;
  let informalPts = 0;
  let eventPts    = 0;
  let lossPts     = 0;
  let laborPts    = 0;
  let corrPts     = 0;
  let queryPts    = 0;
  let pricePts    = 0;

  // Señales de industria en el texto de evento (si tenemos perfil)
  const industryEventPts = profile
    ? profile.eventKeywords.filter((kw) => text.toLowerCase().includes(kw.toLowerCase())).length * 15
    : 0;
  const industryLossPts = profile
    ? profile.lossKeywords.filter((kw) => text.toLowerCase().includes(kw.toLowerCase())).length * 20
    : 0;

  for (const { pattern, signal } of FORMAL_DOC_SIGNALS) {
    if (pattern.test(text)) { formalPts += 30; signals.push(signal); }
  }
  for (const { pattern, signal } of INFORMAL_DOC_SIGNALS) {
    if (pattern.test(text)) { informalPts += 20; signals.push(signal); }
  }
  for (const { pattern, signal } of BUSINESS_EVENT_SIGNALS) {
    if (pattern.test(text)) { eventPts += 25; signals.push(signal); }
  }
  for (const { pattern, signal } of LOSS_SIGNALS) {
    if (pattern.test(text)) { lossPts += 30; signals.push(signal); }
  }
  for (const { pattern, signal } of LABOR_EVENT_SIGNALS) {
    if (pattern.test(text)) { laborPts += 25; signals.push(signal); }
  }
  for (const { pattern, signal } of CORRECTION_SIGNALS) {
    if (pattern.test(text)) { corrPts += 35; signals.push(signal); }
  }
  for (const { pattern, signal } of QUERY_SIGNALS) {
    if (pattern.test(text)) { queryPts += 20; signals.push(signal); }
  }
  for (const { pattern, signal } of PRICE_UPDATE_SIGNALS) {
    if (pattern.test(text)) { pricePts += 25; signals.push(signal); }
  }

  eventPts  += industryEventPts;
  lossPts   += industryLossPts;

  // Determinar ganador
  const scores: [InputIntent, number][] = [
    ['DOCUMENTO_FORMAL',     formalPts],
    ['DOCUMENTO_INFORMAL',   informalPts],
    ['EVENTO_NEGOCIO',       eventPts],
    ['PERDIDA_INVENTARIO',   lossPts],
    ['EVENTO_LABORAL',       laborPts],
    ['CORRECCION',           corrPts],
    ['CONSULTA',             queryPts],
    ['ACTUALIZACION_PRECIO', pricePts],
  ];

  const [winnerIntent, winnerPts] = scores.reduce(
    (best, cur) => cur[1] > best[1] ? cur : best,
    ['DESCONOCIDO' as InputIntent, 0],
  );

  if (winnerPts === 0) {
    return { intent: 'DESCONOCIDO', confidence: 0, signals: [] };
  }

  const confidence = Math.min(100, winnerPts);
  return { intent: winnerIntent, confidence, signals: [...new Set(signals)] };
}
