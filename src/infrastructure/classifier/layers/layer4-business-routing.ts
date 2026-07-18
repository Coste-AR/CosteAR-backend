// src/infrastructure/classifier/layers/layer4-business-routing.ts
import type { DocumentType, CostSection, IndustryCategory, GastoSubtype } from '../types.js';
import { getIndustryProfile, TRANSVERSAL_GASTO_KEYWORDS } from '../industry/industry-profile.js';

export interface Layer4Result {
  costSection: CostSection;
  confidence: number;
  requiresAI: boolean;
  reasoning: string;
  /**
   * Cuando `requiresAI` es true, sección candidata que las reglas deterministas
   * sugieren como prior fuerte para Layer 5 (IA) y el revisor humano. No es una
   * decisión final — es un candidato con fundamento para que la IA/el costista
   * no arranquen de cero (ej. una liquidación de un puesto de mano de obra
   * INDIRECTA → COSTOS_INDIRECTOS, o de un administrativo → GASTO_ADMINISTRACION).
   */
  suggestedSection?: CostSection;
}

/**
 * Diferencia mínima de keywords entre dos secciones (MP vs CIP) para rutear
 * con confianza. Una ventaja de una sola keyword es demasiado débil: el
 * documento menciona insumos de ambas secciones casi por igual → ambiguo,
 * lo desempata la IA en vez de adivinar.
 */
export const SECTION_MARGIN = 2;

/**
 * Conceptos que son Costos Indirectos de Producción en CUALQUIER rubro
 * (criterio de la cátedra: todo lo de producción que no es MP ni MOD directa).
 * Se puntean además de las cipKeywords del perfil para no depender de frases
 * multi-palabra exactas que se rompen con un "de"/"y" en el medio
 * (ej. "seguro de maquinaria", "mantenimiento y reparación").
 */
/**
 * Conceptos "siempre variables → SIEMPRE Costos Indirectos de Producción", sin
 * excepción de contexto (cátedra, doctrina firme): materiales indirectos, fuerza
 * motriz comprada, costos de reproceso y energía de máquinas. A diferencia de
 * flete/seguro (que se rescatan a Materia Prima cuando acompañan una compra de
 * MP), estos NO admiten ninguna excepción: aunque la factura sea mayormente de
 * MP, su presencia HARD-OVERRIDE a CIP (ver short-circuit en `routeFacturaCompra`).
 * Por eso NO figuran en ACQUISITION_INHERENT_KEYWORDS. Cada forma base cubre sus
 * variantes por substring ('reproceso' ⊃ 'costos de reproceso'; 'fuerza motriz' ⊃
 * 'fuerza motriz comprada'; 'materiales indirectos' ⊃ '... de fabricación').
 */
export const UNCONDITIONAL_CIP_KEYWORDS = [
  'fuerza motriz',
  'materiales indirectos', 'material indirecto',
  'reproceso', 'retrabajo',
  'energía de máquinas', 'energia de maquinas',
  'energía eléctrica de planta', 'energia electrica de planta',
  'energía eléctrica de máquinas', 'energia electrica de maquinas',
];

export const UNIVERSAL_CIP_KEYWORDS = [
  'mantenimiento', 'reparación', 'reparacion', 'seguro', 'póliza', 'poliza',
  'alquiler', 'limpieza', 'vigilancia', 'seguridad', 'flete', 'logística',
  'logistica', 'amortización', 'amortizacion', 'depreciación', 'depreciacion',
  'telefonía', 'telefonia', 'internet', 'expensas', 'vtv', 'residuos',
  // Los conceptos siempre-variables también puntean como CIP en el scoring
  // normal (además del short-circuit que los hace ganar sí o sí).
  ...UNCONDITIONAL_CIP_KEYWORDS,
];

/**
 * Conceptos que son INHERENTES al costo de adquisición de la materia prima
 * (cátedra, Clase 4 "Costo de adquisición": FOB + flete + seguro + derechos
 * aduaneros + honorarios/gastos de despachante = costo de adquisición). Estos
 * también figuran como CIP en UNIVERSAL_CIP_KEYWORDS, pero SOLO son CIP cuando
 * vienen SUELTOS (flete de planta, seguro de maquinaria). Cuando acompañan una
 * COMPRA de materia prima, se bundlean en el costo de esa MP y NO deben desviarse
 * a Costos Indirectos. `routeFacturaCompra` los "rescata" para MP en ese caso.
 */
export const ACQUISITION_INHERENT_KEYWORDS = [
  'flete', 'seguro', 'póliza', 'poliza', 'acarreo',
  'despachante', 'derechos aduaneros', 'gastos de aduana',
];

/** Etiqueta legible de cada subtipo de gasto para el reasoning del costista. */
const GASTO_LABELS: Record<GastoSubtype, string> = {
  GASTO_COMERCIALIZACION: 'Gasto de Comercialización',
  GASTO_ADMINISTRACION: 'Gasto de Administración',
  GASTO_FINANCIERO: 'Gasto Financiero',
};

/**
 * Puntea las señales transversales de gasto y devuelve el subtipo ganador.
 * `score` = cantidad de keywords del subtipo líder que aparecen en el texto;
 * `matched` = las frases concretas que dispararon (para explicar la decisión).
 */
function scoreGasto(lower: string): { subtype: GastoSubtype; score: number; matched: string[] } {
  let best: { subtype: GastoSubtype; score: number; matched: string[] } = {
    subtype: 'GASTO_ADMINISTRACION',
    score: 0,
    matched: [],
  };
  for (const subtype of Object.keys(TRANSVERSAL_GASTO_KEYWORDS) as GastoSubtype[]) {
    const matched = TRANSVERSAL_GASTO_KEYWORDS[subtype].filter((kw) => lower.includes(kw.toLowerCase()));
    if (matched.length > best.score) best = { subtype, score: matched.length, matched };
  }
  return best;
}

// ── Ruteo de MANO DE OBRA por puesto (MOD vs mano de obra indirecta) ─────────
//
// Criterio de la cátedra (Clase 1, "Mano de obra: directa e indirecta"): MOD es
// el trabajador IDENTIFICABLE que transforma la materia prima (jornalero,
// operario que corta/cose/etiqueta). Cualquier otro puesto de la planilla
// —capataz, supervisor, gerente de producción, limpieza, vigilancia,
// mantenimiento, sereno— es mano de obra INDIRECTA: su costo (Remuneración +
// Cargas Sociales) va a Costos Indirectos de Producción, NO a MOD. El personal
// administrativo / de conducción general es mano de obra indirecta que ni
// siquiera nace en producción → es GASTO de administración, no costo.

/**
 * Puestos de MANO DE OBRA DIRECTA (MOD). Solo estos se auto-clasifican como MOD
 * sin intervención de IA. Deliberadamente acotado a términos de "línea".
 */
export const MOD_ROLE_KEYWORDS = [
  'jornalero', 'jornalera', 'jornal', 'operario', 'operaria', 'operarios',
  'operador de máquina', 'operador de maquina', 'operador de línea', 'operador de linea',
  'operador de producción', 'operador de produccion', 'maquinista',
  'peón de producción', 'peon de produccion', 'peón', 'peon', 'obrero', 'obrera',
  'personal de producción', 'personal de produccion', 'personal de línea', 'personal de linea',
  'mano de obra directa',
];

/**
 * Puestos de mano de obra INDIRECTA dentro de producción → Costos Indirectos
 * de Producción (CIP). Incluye supervisión de planta y servicios de producción.
 */
export const CIP_ROLE_KEYWORDS = [
  'capataz', 'supervisor', 'supervisora', 'encargado', 'encargada',
  'jefe de producción', 'jefe de produccion', 'jefe de planta', 'jefe de turno',
  'jefe de fábrica', 'jefe de fabrica',
  'gerente de producción', 'gerente de produccion', 'gerente de planta',
  'gerente de fábrica', 'gerente de fabrica',
  'limpieza', 'personal de limpieza', 'maestranza',
  'vigilancia', 'vigilador', 'guardia de seguridad', 'sereno', 'portero', 'ordenanza',
  'mantenimiento', 'personal de mantenimiento',
  'control de calidad', 'controlador de calidad', 'foreman',
];

/**
 * Puestos administrativos / de conducción general → GASTO_ADMINISTRACION.
 * Mano de obra indirecta que NO nace en producción: es gasto, no costo del
 * producto. "gerente" sin calificador de planta/fábrica/producción cae acá.
 */
export const ADMIN_ROLE_KEYWORDS = [
  'administrativo', 'administrativa', 'personal administrativo', 'empleado administrativo',
  'gerente general', 'gerente de administración', 'gerente de administracion',
  'gerente administrativo', 'gerente comercial', 'gerente de ventas',
  'gerente de finanzas', 'gerente financiero',
  'director', 'directorio', 'contador', 'recepcionista', 'secretaria', 'secretario',
  'recursos humanos', 'rrhh', 'tesorería', 'tesoreria', 'cobranzas',
  // Genérico: debe ir ÚLTIMO. Los buckets CIP/ADMIN calificados se evalúan antes.
  'gerente',
];

type PayrollRoleBucket = 'MOD' | 'CIP' | 'ADMIN' | 'UNKNOWN';

function matchAnyKeyword(haystack: string, keywords: string[]): string | null {
  for (const kw of keywords) if (haystack.includes(kw)) return kw;
  return null;
}

/**
 * Extrae el puesto de una línea etiquetada del texto ("Puesto/Cargo: X").
 * NO escanea el cuerpo completo de la liquidación a propósito: un recibo suele
 * decir "Seguridad Social", "Obra Social", etc., y un match ciego sobre esas
 * palabras rutearía mal. Solo confiamos en el campo de rol explícito.
 */
export function extractRoleFromText(text: string): string | null {
  // 1) Campo de rol específico y explícito — máxima precisión.
  const labeled = text.match(/(?:puesto|cargo|categor[ií]a|funci[oó]n)\s*[:\-]\s*([^\n]+)/i);
  if (labeled?.[1]) return labeled[1].trim();
  // 2) Línea de empleado de un recibo ("Empleado: Nombre — puesto"): en los
  //    recibos argentinos el puesto suele ir junto al nombre. Se usa solo si no
  //    hubo un campo de puesto/categoría explícito.
  const empleado = text.match(/empleado\s*[:\-]\s*([^\n]+)/i);
  if (empleado?.[1]) return empleado[1].trim();
  return null;
}

/**
 * Clasifica el puesto/cargo de una liquidación en su bucket contable.
 * Prioridad: CIP (indirecta de producción) → ADMIN → MOD, para que
 * "gerente de producción" gane a la regla genérica de "gerente" (ADMIN).
 */
export function classifyPayrollRole(role: string | null): {
  bucket: PayrollRoleBucket;
  matched: string | null;
} {
  if (!role || !role.trim()) return { bucket: 'UNKNOWN', matched: null };
  const r = role.toLowerCase();
  const cip = matchAnyKeyword(r, CIP_ROLE_KEYWORDS);
  if (cip) return { bucket: 'CIP', matched: cip };
  const admin = matchAnyKeyword(r, ADMIN_ROLE_KEYWORDS);
  if (admin) return { bucket: 'ADMIN', matched: admin };
  const mod = matchAnyKeyword(r, MOD_ROLE_KEYWORDS);
  if (mod) return { bucket: 'MOD', matched: mod };
  return { bucket: 'UNKNOWN', matched: null };
}

/**
 * Rutea una liquidación de haberes / planilla de horas según el puesto.
 * MOD (o sin señal que contradiga) se auto-clasifica; un puesto de mano de obra
 * indirecta o administrativa NO se auto-clasifica: escala a IA/revisión con la
 * sección candidata como prior fuerte.
 */
function routePayroll(text: string, extractedRole?: string | null): Layer4Result {
  const role = (extractedRole?.trim() || extractRoleFromText(text)) || null;
  const { bucket, matched } = classifyPayrollRole(role);

  if (bucket === 'CIP') {
    return {
      costSection: 'COSTOS_INDIRECTOS',
      suggestedSection: 'COSTOS_INDIRECTOS',
      confidence: 60,
      requiresAI: true,
      reasoning: `Liquidación de "${role}" (${matched}) → mano de obra INDIRECTA de producción, no MOD → candidato: Costos Indirectos de Producción (requiere confirmación)`,
    };
  }
  if (bucket === 'ADMIN') {
    return {
      costSection: 'GASTO_ADMINISTRACION',
      suggestedSection: 'GASTO_ADMINISTRACION',
      confidence: 60,
      requiresAI: true,
      reasoning: `Liquidación de "${role}" (${matched}) → personal administrativo / de conducción, fuera de producción → candidato: Gasto de Administración (requiere confirmación)`,
    };
  }

  // MOD explícito, puesto no reconocido, o sin puesto → default MOD.
  let note: string;
  if (bucket === 'MOD') {
    note = `puesto directo de producción (${matched})`;
  } else if (role) {
    note = `puesto "${role}" no reconocido → no contradice mano de obra directa, se asume MOD (revisar)`;
  } else {
    note = 'sin puesto informado → se asume MOD (LIMITACIÓN CONOCIDA: sin señal de rol no se distingue MOD de mano de obra indirecta)';
  }
  return {
    costSection: 'MANO_DE_OBRA',
    confidence: 99,
    requiresAI: false,
    reasoning: `Liquidación de haberes o planilla de horas → Mano de Obra Directa (${note})`,
  };
}

/**
 * Layer 4: Business Routing con conciencia de rubro.
 * Determina a qué sección de costos pertenece un documento.
 *
 * Usa el perfil de industria para sobreescribir las reglas genéricas
 * cuando el rubro tiene convenciones distintas.
 *
 * `extractedRole` es el puesto/cargo que Groq extrajo del documento (si lo hay);
 * se usa para distinguir mano de obra directa de indirecta en liquidaciones.
 */
export function runLayer4(
  documentType: DocumentType | string,
  text: string,
  industryCategory: IndustryCategory = 'DEFAULT',
  extractedRole?: string | null,
): Layer4Result {
  const lower = text.toLowerCase();
  const profile = getIndustryProfile(industryCategory);

  switch (documentType) {
    // ── Liquidaciones y planillas → MOD solo si el puesto es directo ──────────
    // MOD = trabajador que transforma la MP (jornalero/operario). Otros puestos
    // (capataz, supervisor, gerente, limpieza, vigilancia, mantenimiento…) son
    // mano de obra indirecta → escalan a IA/revisión, no se auto-clasifican.
    case 'LIQUIDACION_MOD':
    case 'PLANILLA_HORAS':
      return routePayroll(text, extractedRole);

    // ── Facturas de venta → siempre VENTAS ───────────────────────────────────
    case 'FACTURA_VENTA':
      return {
        costSection: 'VENTAS',
        confidence: 99,
        requiresAI: false,
        reasoning: 'Factura de venta emitida → Ventas',
      };

    // ── Notas de débito/crédito → según qué corrigen (venta vs compra) ────────
    // Una nota NO es CIP por defecto: corrige un documento previo y hereda su
    // sección. Nota sobre una VENTA (devolución/ajuste a cliente) → reduce
    // Ventas. Nota sobre una COMPRA → se rutea por CONTENIDO exactamente igual
    // que una factura de compra (misma MP/CIP/GASTO, mismo override de CIP
    // incondicional y misma excepción flete/seguro). Ver `routeNota`.
    case 'NOTA_DEBITO':
    case 'NOTA_CREDITO':
      return routeNota(
        documentType === 'NOTA_CREDITO' ? 'Nota de crédito' : 'Nota de débito',
        lower,
        profile,
        industryCategory,
      );

    // ── Remito → según contexto o IA ─────────────────────────────────────────
    case 'REMITO': {
      if (/\brecibimos\b|\bentrada\b|\bcompra\b/i.test(text)) {
        return {
          costSection: 'MATERIA_PRIMA',
          confidence: 80,
          requiresAI: false,
          reasoning: 'Remito de entrada/compra → Materia Prima',
        };
      }
      if (/\bdespachamos\b|\bsalida\b|\bventa\b/i.test(text)) {
        return {
          costSection: 'VENTAS',
          confidence: 80,
          requiresAI: false,
          reasoning: 'Remito de salida/venta → Ventas',
        };
      }
      return {
        costSection: 'DESCONOCIDO',
        confidence: 50,
        requiresAI: true,
        reasoning: 'Remito sin dirección clara → requiere análisis adicional',
      };
    }

    // ── Factura de compra → análisis detallado con contexto de rubro ─────────
    case 'FACTURA_COMPRA': {
      return routeFacturaCompra(lower, profile, industryCategory);
    }

    default:
      return {
        costSection: 'DESCONOCIDO',
        confidence: 0,
        requiresAI: true,
        reasoning: 'Tipo de documento no reconocido → requiere análisis',
      };
  }
}

// ── Ruteo de Notas de Débito / Crédito ───────────────────────────────────────
//
// Doctrina (cátedra): una nota de crédito/débito corrige un documento previo y
// hereda SU sección — no es Costos Indirectos "por defecto". Nota sobre una
// VENTA (devolución o ajuste a un cliente) reduce VENTAS; nota sobre una COMPRA
// reduce lo que la compra original haya sido (MP / CIP / GASTO). No linkeamos
// el documento original: reusamos las MISMAS señales de contenido que una
// factura equivalente (routeFacturaCompra) para inferir la sección.

/**
 * Marcadores INEQUÍVOCOS de que la nota corrige una VENTA emitida (devolución o
 * ajuste a un cliente) → reduce Ventas. Reutiliza los mismos marcadores de venta
 * emitida que usa la detección de FACTURA_VENTA (definitive-signals: "factura de
 * venta", "venta a cliente", "vendimos", "nota de venta") y agrega los propios de
 * una devolución de cliente. Deliberadamente NO usa "cliente" a secas: en una
 * COMPRA nuestra empresa figura como "Cliente" del proveedor, así que sería
 * ambiguo. Sin uno de estos marcadores la nota se asume corrección de una COMPRA.
 */
const NOTA_VENTA_CONTEXT =
  /\bfactura\s+[abc]?\s*de\s+venta\b|\bventa\s+a\s+cliente\b|\bvendimos\b|\bnota\s+de\s+venta\b|\bpor\s+(la\s+)?venta\b|\bdevoluci[oó]n\s+de\s+(mercader[ií]a\s+)?vendida\b|\bdevoluci[oó]n\s+del?\s+cliente\b|\bel\s+cliente\s+(nos\s+)?devolvi[oó]\b|\bnota\s+de\s+cr[eé]dito\s+a\s+cliente\b/i;

/**
 * Rutea una NOTA_DEBITO / NOTA_CREDITO. Venta (devolución/ajuste a cliente) →
 * VENTAS. En otro caso se rutea por CONTENIDO reusando `routeFacturaCompra`
 * (idéntico a una factura de compra: override de CIP incondicional, excepción
 * flete/seguro de MP, gasto transversal, punteo MP/CIP). Como `routeFacturaCompra`
 * ya escala a IA (`requiresAI: true`) cuando el contenido es ambiguo o no hay
 * señal, una nota genuinamente ambigua NO se auto-clasifica: hereda esa política.
 */
function routeNota(
  docLabel: string,
  lower: string,
  profile: ReturnType<typeof getIndustryProfile>,
  industryCategory: IndustryCategory,
): Layer4Result {
  if (NOTA_VENTA_CONTEXT.test(lower)) {
    return {
      costSection: 'VENTAS',
      confidence: 90,
      requiresAI: false,
      reasoning: `${docLabel} sobre una VENTA (devolución/ajuste a cliente) → reduce Ventas, igual que la factura de venta que corrige`,
    };
  }

  // Corrige una COMPRA → misma clasificación por contenido que una factura de
  // compra. Reusamos la función completa para no duplicar la lógica de keywords:
  // cualquier fix futuro al ruteo de facturas aplica también a las notas.
  const routed = routeFacturaCompra(lower, profile, industryCategory);
  return {
    ...routed,
    reasoning: `${docLabel} sobre una COMPRA → ruteada por contenido como factura de compra: ${routed.reasoning}`,
  };
}

// ── Routing de Factura de Compra con perfil de industria ─────────────────────

function routeFacturaCompra(
  lower: string,
  profile: ReturnType<typeof getIndustryProfile>,
  industryCategory: IndustryCategory,
): Layer4Result {

  // Conceptos "siempre variables" (materiales indirectos, fuerza motriz, reproceso,
  // energía de máquinas): HARD-OVERRIDE a CIP antes que cualquier otra regla, sin
  // importar el rubro ni que la factura tenga señales fuertes de MP. Son CIP por
  // definición de la cátedra, sin excepción (cf. flete/seguro, que sí se rescatan
  // a MP en una compra de MP). Se evalúa primero para que gane a MP/energía-MP.
  const unconditionalCip = UNCONDITIONAL_CIP_KEYWORDS.filter((kw) => lower.includes(kw));
  if (unconditionalCip.length > 0) {
    return {
      costSection: 'COSTOS_INDIRECTOS',
      confidence: 95,
      requiresAI: false,
      reasoning: `Concepto siempre variable (${unconditionalCip.slice(0, 3).join(', ')}) → Costos Indirectos de Producción por definición de la cátedra, sin excepción de contexto (no se desvía a Materia Prima)`,
    };
  }

  // Primero: combustible/energía — dependen del rubro
  const hasFuel    = /\bgasoil\b|\bcombustible\b|\bnafta\b|\bGNC\b/.test(lower);
  const hasEnergy  = /\belectricidad\b|\bluz el[eé]ctrica\b|\bgas natural\b|\benergia\b/.test(lower);

  if (hasFuel && profile.fuelIsMP) {
    return {
      costSection: 'MATERIA_PRIMA',
      confidence: 88,
      requiresAI: false,
      reasoning: `Combustible en rubro ${profile.label} → Materia Prima (insumo de producción directa)`,
    };
  }
  if (hasEnergy && profile.energyIsMP) {
    return {
      costSection: 'MATERIA_PRIMA',
      confidence: 85,
      requiresAI: false,
      reasoning: `Energía en rubro ${profile.label} → Materia Prima (insumo directo del proceso)`,
    };
  }

  // Punteo de keywords por sección usando el perfil del rubro.
  // CIP suma las del perfil + las universales (dedup) para no depender de
  // frases exactas del rubro.
  const cipKw = [...new Set([...profile.cipKeywords, ...UNIVERSAL_CIP_KEYWORDS])];
  const mpScore  = profile.mpKeywords.filter((kw)  => lower.includes(kw.toLowerCase())).length;
  const cipScore = cipKw.filter((kw) => lower.includes(kw.toLowerCase())).length;
  const modScore = profile.modKeywords.filter((kw) => lower.includes(kw.toLowerCase())).length;

  // ── Gasto (no-costo) transversal ──────────────────────────────────────────
  // Se evalúa ANTES que MP/MOD/CIP: un gasto de comercialización/administración
  // /financiero no es costo inventariable y no debe caer en CIP. Solo ruteamos
  // con confianza cuando la señal de gasto SUPERA claramente a MP/CIP/MOD; si
  // está peleada, es genuinamente ambiguo entre costo y gasto → lo desempata la
  // IA (Layer 5) en vez de adivinar.
  const gasto = scoreGasto(lower);
  if (gasto.score >= 1) {
    const competing = Math.max(mpScore, cipScore, modScore);
    if (gasto.score > competing) {
      const conf = 85 + Math.min(gasto.score * 3, 12);
      return {
        costSection: gasto.subtype,
        confidence: conf,
        requiresAI: false,
        reasoning: `Factura con señales de ${GASTO_LABELS[gasto.subtype]} (${gasto.matched.slice(0, 3).join(', ')}) → gasto no inventariable, fuera de Costos Indirectos de Producción`,
      };
    }
    return {
      costSection: 'DESCONOCIDO',
      confidence: 55,
      requiresAI: true,
      reasoning: `Factura con señales de ${GASTO_LABELS[gasto.subtype]} (${gasto.score}) peleadas con Materia Prima (${mpScore}) / Costos Indirectos (${cipScore}) → ambiguo entre costo y gasto, requiere análisis por IA`,
    };
  }

  // MOD: si el texto menciona servicios de personal directo
  if (modScore > 0 && modScore >= mpScore && modScore >= cipScore) {
    return {
      costSection: 'MANO_DE_OBRA',
      confidence: 80,
      requiresAI: false,
      reasoning: `Factura con indicadores de mano de obra directa (${modScore} señales)`,
    };
  }

  // ── Flete / seguro inherentes a una COMPRA de materia prima (cátedra) ─────
  // El flete y el seguro que acompañan una factura de compra de MP son parte
  // del COSTO DE ADQUISICIÓN de esa MP (Clase 4), no un costo indirecto aparte.
  // UNIVERSAL_CIP_KEYWORDS los putea como CIP por defecto; acá los rescatamos
  // para MATERIA_PRIMA cuando la MISMA factura tiene contexto de compra de MP.
  // Sin contexto de MP (flete/seguro suelto) NO entra acá → sigue el flujo
  // normal y queda en CIP como antes (sin regresión).
  const freightInsuranceMatched = ACQUISITION_INHERENT_KEYWORDS.filter((kw) => lower.includes(kw));
  if (freightInsuranceMatched.length > 0 && mpScore >= 1) {
    // CIP "de verdad": señales de costo indirecto que NO son flete/seguro de
    // adquisición (ej. alquiler, energía, mantenimiento, seguro de maquinaria).
    const cipCoreScore = cipKw
      .filter((kw) => !ACQUISITION_INHERENT_KEYWORDS.includes(kw.toLowerCase()))
      .filter((kw) => lower.includes(kw.toLowerCase()))
      .length;

    // Hay una compra de MP que LIDERA con claridad (margen ≥ SECTION_MARGIN)
    // sobre otros conceptos de CIP → el flete/seguro se bundlea en el costo de
    // la MP. Exigimos un lead claro (no un empate) para no bundlear cuando el
    // "seguro"/"flete" es en realidad de planta (ej. "carne y seguro del local",
    // 1 MP vs 1 CIP): esos casos son ambiguos y bajan al escalado de abajo.
    if (mpScore - cipCoreScore >= SECTION_MARGIN) {
      const conf = 82 + Math.min(mpScore * 3, 13);
      const matchedMp = profile.mpKeywords.filter((kw) => lower.includes(kw.toLowerCase())).slice(0, 3);
      return {
        costSection: 'MATERIA_PRIMA',
        confidence: conf,
        requiresAI: false,
        reasoning: `Compra de Materia Prima (${matchedMp.join(', ')}) con flete/seguro (${freightInsuranceMatched.join(', ')}) inherentes al costo de adquisición → se mantiene en Materia Prima, no se desvía a Costos Indirectos`,
      };
    }

    // Hay compra de MP pero también señales fuertes de otros CIP → genuinamente
    // ambiguo si el flete/seguro integra el costo de adquisición o es CIP de
    // planta → lo desempata la IA, con Materia Prima como prior.
    return {
      costSection: 'DESCONOCIDO',
      suggestedSection: 'MATERIA_PRIMA',
      confidence: 55,
      requiresAI: true,
      reasoning: `Factura con compra de Materia Prima (${mpScore}) + flete/seguro (${freightInsuranceMatched.join(', ')}) pero también otros Costos Indirectos (${cipCoreScore}) → ambiguo si el flete integra el costo de adquisición o es CIP de planta, requiere análisis por IA`,
    };
  }

  // Ambigüedad de sección: si MP y CIP están peleados (ambos con señales y la
  // ventaja es de una sola keyword), no adivinamos → desempata la IA.
  if (mpScore >= 1 && cipScore >= 1 && Math.abs(mpScore - cipScore) < SECTION_MARGIN) {
    return {
      costSection: 'DESCONOCIDO',
      confidence: 55,
      requiresAI: true,
      reasoning: `Factura con señales parejas de Materia Prima (${mpScore}) y Costos Indirectos (${cipScore}) → ambiguo, requiere análisis por IA`,
    };
  }

  if (mpScore > cipScore && mpScore >= 1) {
    const conf = 82 + Math.min(mpScore * 3, 15);
    const matched = profile.mpKeywords.filter((kw) => lower.includes(kw.toLowerCase())).slice(0, 3);
    return {
      costSection: 'MATERIA_PRIMA',
      confidence: conf,
      requiresAI: false,
      reasoning: `Factura de compra con insumos de Materia Prima en rubro ${profile.label} (${matched.join(', ')})`,
    };
  }

  if (cipScore > mpScore && cipScore >= 1) {
    const conf = 82 + Math.min(cipScore * 3, 15);
    const matched = cipKw.filter((kw) => lower.includes(kw.toLowerCase())).slice(0, 3);
    return {
      costSection: 'COSTOS_INDIRECTOS',
      confidence: conf,
      requiresAI: false,
      reasoning: `Factura de compra con costos indirectos en rubro ${profile.label} (${matched.join(', ')})`,
    };
  }

  // Sin keywords detectadas → fallback a Groq con contexto de rubro
  return {
    costSection: 'DESCONOCIDO',
    confidence: 50,
    requiresAI: true,
    reasoning: `Sin señales de clasificación suficientes para rubro ${profile.label} → requiere análisis por IA`,
  };
}
