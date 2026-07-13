// src/infrastructure/classifier/layers/layer4-business-routing.ts
import type { DocumentType, CostSection, IndustryCategory } from '../types.js';
import { getIndustryProfile } from '../industry/industry-profile.js';

export interface Layer4Result {
  costSection: CostSection;
  confidence: number;
  requiresAI: boolean;
  reasoning: string;
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
export const UNIVERSAL_CIP_KEYWORDS = [
  'mantenimiento', 'reparación', 'reparacion', 'seguro', 'póliza', 'poliza',
  'alquiler', 'limpieza', 'vigilancia', 'seguridad', 'flete', 'logística',
  'logistica', 'amortización', 'amortizacion', 'depreciación', 'depreciacion',
  'telefonía', 'telefonia', 'internet', 'expensas', 'vtv', 'residuos',
];

/**
 * Layer 4: Business Routing con conciencia de rubro.
 * Determina a qué sección de costos pertenece un documento.
 *
 * Usa el perfil de industria para sobreescribir las reglas genéricas
 * cuando el rubro tiene convenciones distintas.
 */
export function runLayer4(
  documentType: DocumentType | string,
  text: string,
  industryCategory: IndustryCategory = 'DEFAULT',
): Layer4Result {
  const lower = text.toLowerCase();
  const profile = getIndustryProfile(industryCategory);

  switch (documentType) {
    // ── Liquidaciones y planillas → siempre MOD ───────────────────────────────
    case 'LIQUIDACION_MOD':
    case 'PLANILLA_HORAS':
      return {
        costSection: 'MANO_DE_OBRA',
        confidence: 99,
        requiresAI: false,
        reasoning: 'Liquidación de haberes o planilla de horas → Mano de Obra Directa',
      };

    // ── Facturas de venta → siempre VENTAS ───────────────────────────────────
    case 'FACTURA_VENTA':
      return {
        costSection: 'VENTAS',
        confidence: 99,
        requiresAI: false,
        reasoning: 'Factura de venta emitida → Ventas',
      };

    // ── Notas de débito/crédito → CIP por defecto ─────────────────────────────
    case 'NOTA_DEBITO':
    case 'NOTA_CREDITO':
      return {
        costSection: 'COSTOS_INDIRECTOS',
        confidence: 85,
        requiresAI: false,
        reasoning: 'Nota de débito/crédito → Costos Indirectos de Producción',
      };

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

// ── Routing de Factura de Compra con perfil de industria ─────────────────────

function routeFacturaCompra(
  lower: string,
  profile: ReturnType<typeof getIndustryProfile>,
  industryCategory: IndustryCategory,
): Layer4Result {

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

  // MOD: si el texto menciona servicios de personal directo
  if (modScore > 0 && modScore >= mpScore && modScore >= cipScore) {
    return {
      costSection: 'MANO_DE_OBRA',
      confidence: 80,
      requiresAI: false,
      reasoning: `Factura con indicadores de mano de obra directa (${modScore} señales)`,
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
