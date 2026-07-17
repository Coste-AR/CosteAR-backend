// src/infrastructure/classifier/layers/layer0a-intent-detection.ts
import type { InputIntent, IndustryCategory, WasteNature } from '../types.js';
import type { IndustryProfile } from '../industry/industry-profile.js';

export interface IntentResult {
  intent: InputIntent;
  confidence: number;  // 0-100, qué tan seguro estamos del intent
  signals: string[];   // señales que dispararon esta clasificación
  // Naturaleza de la merma, cuando el texto menciona pérdida/merma. Es un eje
  // de clasificación general (no atado al método de costeo). Ausente si el
  // documento no habla de merma.
  wasteNature?: WasteNature;
  // Revisión humana OBLIGATORIA: se activa cuando hay merma de naturaleza
  // ambigua (no sabemos si es normal o extraordinaria). "Cero errores
  // silenciosos": no se auto-clasifica ni como pérdida ni como costo.
  requiresReview?: boolean;
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

// ── Eje de merma: normal (costeable) vs extraordinaria (pérdida) ─────────────
//
// Doctrina (cátedra): la merma NORMAL es esperada, rutinaria y dentro de rango;
// se absorbe en el costo de las unidades buenas → NO es pérdida, sigue siendo
// costo del producto. Solo la merma EXTRAORDINARIA (siniestro, evento anormal)
// cae fuera del costo y se reconoce como pérdida en el Estado de Resultados.
//
// Este eje se modela como una CLASIFICACIÓN GENERAL desacoplada del método de
// costeo: acá decidimos QUÉ es la merma (normal/extraordinaria/ambigua), no
// CÓMO se absorbe. El día de mañana, costeo por órdenes y costeo por procesos
// consumen esta misma naturaleza y cada uno la absorbe a su manera (CAUO en
// procesos, recargo al CIP/orden en órdenes) sin tener que re-detectarla acá.

// (1) Eventos intrínsecamente EXTRAORDINARIOS (siniestro). Por su naturaleza
//     son pérdida, no necesitan calificador: fuego, robo, inundación, ruptura
//     de cadena de frío. Un incendio es un incendio.
const EXTRAORDINARY_EVENT_SIGNALS: { pattern: RegExp; signal: string }[] = [
  // Ojo: `\b` no matchea después de una vocal acentuada (en JS `ó` es no-word),
  // por eso los tokens que terminan en acento cierran con `(?!\w)`, no con `\b`.
  { pattern: /\bse\s+(quem[oó]|incendi[oó])(?!\w)/i,                   signal: 'Quema/incendio' },
  { pattern: /\bincendi(o|ó)(?!\w)/i,                                  signal: 'Incendio' },
  { pattern: /\brobo\b|\brobaron\b|\bhurto\b|\basalto\b|\bsaqueo\b/i,  signal: 'Robo/hurto' },
  { pattern: /\binundaci[oó]n\b|\banegad[oa]s?\b|\bse\s+inund[oó](?!\w)/i, signal: 'Inundación' },
  { pattern: /\bsiniestro\b/i,                                         signal: 'Siniestro' },
  { pattern: /\bcorte\s+de\s+frío\b|\bfalla\s+(en\s+)?(la\s+)?cadena\s+de\s+frío\b|\bse\s+cort[oó]\s+la\s+cadena\s+de\s+frío\b/i, signal: 'Ruptura cadena frío' },
];

// (2) Calificadores que marcan una merma como EXTRAORDINARIA (anormal, one-off).
const EXTRAORDINARY_QUALIFIERS: { pattern: RegExp; signal: string }[] = [
  { pattern: /\bextraordinari[oa]s?\b/i,                        signal: 'Merma extraordinaria' },
  { pattern: /\banormal(es)?\b/i,                               signal: 'Merma anormal' },
  { pattern: /\bfuera\s+de\s+lo\s+(normal|habitual|previsto|esperado)\b/i, signal: 'Fuera de lo normal' },
  { pattern: /\bp[eé]rdida\s+total\b/i,                         signal: 'Pérdida total' },
  { pattern: /\b(se\s+)?(perdi[oó]|pudri[oó]|arruin[oó]|estrope[oó]|ech[oó]\s+a\s+perder|inutiliz[oó])\s+(todo|toda|todos|todas|el\s+total|por\s+completo|la\s+totalidad)\b/i, signal: 'Deterioro total' },
  { pattern: /\bmerma\s+(no\s+prevista|imprevista|inusual|excepcional)\b/i, signal: 'Merma imprevista' },
];

// (3) Calificadores que marcan una merma como NORMAL (esperada, dentro de rango).
const NORMAL_QUALIFIERS: { pattern: RegExp; signal: string }[] = [
  { pattern: /\bdentro\s+de\s+lo\s+(normal|esperado|previsto|habitual)\b/i, signal: 'Dentro de lo normal' },
  { pattern: /\bdentro\s+del\s+(rango|porcentaje|l[ií]mite|est[aá]ndar)\b/i, signal: 'Dentro del rango' },
  { pattern: /\bmerma\s+(normal|de\s+proceso|habitual|esperada|est[aá]ndar|prevista|de\s+producci[oó]n|t[eé]cnica|t[ií]pica)\b/i, signal: 'Merma normal/de proceso' },
  { pattern: /\bdesperdicio\s+(normal|habitual|de\s+proceso|esperado|est[aá]ndar|t[eé]cnico)\b/i, signal: 'Desperdicio normal' },
  { pattern: /\bscrap\s+de\s+proceso\b/i,                       signal: 'Scrap de proceso' },
  { pattern: /\b(%|por\s*ciento|porcentaje)\s+(habitual|normal|esperado|de\s+siempre)\b/i, signal: '% habitual' },
  { pattern: /\brecorte(s)?\s+de\s+(material|producci[oó]n|proceso|tela|chapa)\b/i, signal: 'Recorte de proceso' },
  { pattern: /\b(es|son|fue|fueron)\s+(lo\s+)?(normal|habitual|de\s+siempre|de\s+rutina)\b/i, signal: 'Merma habitual' },
];

// (4) Lenguaje de merma GENÉRICO: indica que hay merma, pero NO su naturaleza.
//     Sin un calificador (3) o evento (1) que lo aclare, es AMBIGUO → revisión.
const GENERIC_WASTE_SIGNALS: { pattern: RegExp; signal: string }[] = [
  { pattern: /\bmerma\b/i,                                      signal: 'Merma' },
  { pattern: /\bdesperdicio\b/i,                                signal: 'Desperdicio' },
  { pattern: /\bscrap\b/i,                                      signal: 'Scrap' },
  { pattern: /\b(producto\s+)?defectuos[oa]s?\b/i,             signal: 'Producto defectuoso' },
  { pattern: /\bse\s+venci[oó](?!\w)|\bvencid[oa]s?\b/i,        signal: 'Vencimiento' },
  { pattern: /\bse\s+(perdi[oó]|estrope[oó]|da[ñn][oó]|pudri[oó]|arruin[oó])(?!\w)/i, signal: 'Deterioro de material' },
  { pattern: /\brotura(s)?\b|\bquebrad[oa]s?\b|\brotos?\b/i,    signal: 'Rotura' },
];

/**
 * Clasifica la naturaleza de la merma mencionada en el texto.
 *
 * Devuelve `null` si el texto NO menciona ninguna merma/pérdida (el eje no
 * aplica). Si la menciona, devuelve su naturaleza + las señales que la
 * fundamentan.
 *
 * Precedencia:
 *  1. Evento extraordinario duro (fuego/robo/inundación/siniestro) → siempre
 *     EXTRAORDINARY, aunque haya lenguaje "normal" (un incendio no es rutina).
 *  2. Calificador extraordinario Y normal a la vez, sin evento duro → señales
 *     contradictorias → AMBIGUOUS (revisión).
 *  3. Calificador extraordinario → EXTRAORDINARY.
 *  4. Calificador normal → NORMAL.
 *  5. Solo lenguaje genérico de merma, sin calificador → AMBIGUOUS.
 */
export function classifyWaste(
  text: string,
): { nature: WasteNature; signals: string[] } | null {
  const hardEvent: string[]       = [];
  const extraQualifier: string[]  = [];
  const normalQualifier: string[] = [];
  let generic = false;

  for (const { pattern, signal } of EXTRAORDINARY_EVENT_SIGNALS)
    if (pattern.test(text)) hardEvent.push(signal);
  for (const { pattern, signal } of EXTRAORDINARY_QUALIFIERS)
    if (pattern.test(text)) extraQualifier.push(signal);
  for (const { pattern, signal } of NORMAL_QUALIFIERS)
    if (pattern.test(text)) normalQualifier.push(signal);
  for (const { pattern } of GENERIC_WASTE_SIGNALS)
    if (pattern.test(text)) { generic = true; break; }

  const hasExtra  = hardEvent.length > 0 || extraQualifier.length > 0;
  const hasNormal = normalQualifier.length > 0;

  // El texto no habla de merma/pérdida en absoluto → el eje no aplica.
  if (!hasExtra && !hasNormal && !generic) return null;

  // 1. Un siniestro manda por sobre cualquier calificador normal.
  if (hardEvent.length > 0) {
    return { nature: 'EXTRAORDINARY', signals: [...hardEvent, ...extraQualifier] };
  }
  // 2. Extraordinario + normal a la vez (sin evento duro) → contradicción.
  if (extraQualifier.length > 0 && hasNormal) {
    return { nature: 'AMBIGUOUS', signals: [...extraQualifier, ...normalQualifier] };
  }
  // 3. Calificador extraordinario claro.
  if (extraQualifier.length > 0) {
    return { nature: 'EXTRAORDINARY', signals: extraQualifier };
  }
  // 4. Calificador normal claro.
  if (hasNormal) {
    return { nature: 'NORMAL', signals: normalQualifier };
  }
  // 5. Solo hay lenguaje de merma, sin decir de qué tipo → no asumir nada.
  return { nature: 'AMBIGUOUS', signals: ['Merma sin naturaleza declarada'] };
}

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

  eventPts += industryEventPts;

  // ── Eje normal/extraordinario de merma ──────────────────────────────────────
  // Decidimos la NATURALEZA de la merma (si el texto la menciona) y en función
  // de eso decidimos qué hacer con el intent PERDIDA_INVENTARIO:
  //   - EXTRAORDINARY → es pérdida real → puntúa PERDIDA_INVENTARIO (como antes).
  //   - NORMAL        → se absorbe en el costo → NO puntúa: el documento sigue
  //                     por la cascada (layers 1-4) y cae en MP/CIP por contexto.
  //   - AMBIGUOUS     → no asumimos nada → revisión humana obligatoria.
  // Las lossKeywords del rubro también cuentan como "hay merma": si están
  // presentes pero sin naturaleza declarada, se tratan como ambiguas.
  const wasteAssessment = classifyWaste(text);
  let wasteNature: WasteNature | undefined;
  let wasteReviewRequired = false;

  if (wasteAssessment || industryLossPts > 0) {
    const nature: WasteNature = wasteAssessment?.nature ?? 'AMBIGUOUS';
    wasteNature = nature;
    if (wasteAssessment) signals.push(...wasteAssessment.signals);

    if (nature === 'EXTRAORDINARY') {
      // Pérdida real: puntúa como antes (30 por señal + keywords del rubro).
      const extraPts = wasteAssessment ? wasteAssessment.signals.length * 30 : 30;
      lossPts += extraPts + industryLossPts;
    } else if (nature === 'NORMAL') {
      // Merma normal: se absorbe en el costo. NO es pérdida → no puntúa loss.
      lossPts = 0;
    } else {
      // Ambigua: ni pérdida ni costo sin confirmación → revisión humana.
      lossPts = 0;
      wasteReviewRequired = true;
    }
  }

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
    // Sin ganador. Si había merma ambigua, igual la marcamos para revisión y
    // reportamos su naturaleza para que la cascada no la deje pasar en silencio.
    return {
      intent: 'DESCONOCIDO',
      confidence: 0,
      signals: [...new Set(signals)],
      wasteNature,
      requiresReview: wasteReviewRequired || undefined,
    };
  }

  const confidence = Math.min(100, winnerPts);
  return {
    intent: winnerIntent,
    confidence,
    signals: [...new Set(signals)],
    wasteNature,
    requiresReview: wasteReviewRequired || undefined,
  };
}
