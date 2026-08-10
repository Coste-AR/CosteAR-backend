import type { IndustryCategory } from '../types.js';
import { getIndustryProfile } from '../industry/industry-profile.js';
import type { Layer4Result } from './layer4-business-routing.js';
import {
  SECTION_MARGIN,
  UNCONDITIONAL_CIP_KEYWORDS,
  UNIVERSAL_CIP_KEYWORDS,
  ACQUISITION_INHERENT_KEYWORDS,
  GASTO_LABELS,
  scoreGasto,
} from './layer4-keywords.js';

export const NOTA_VENTA_CONTEXT =
  /\bfactura\s+[abc]?\s*de\s+venta\b|\bventa\s+a\s+cliente\b|\bvendimos\b|\bnota\s+de\s+venta\b|\bpor\s+(la\s+)?venta\b|\bdevoluci[oó]n\s+de\s+(mercader[ií]a\s+)?vendida\b|\bdevoluci[oó]n\s+del?\s+cliente\b|\bel\s+cliente\s+(nos\s+)?devolvi[oó]\b|\bnota\s+de\s+cr[eé]dito\s+a\s+cliente\b/i;

export function routeNota(
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

  const routed = routeFacturaCompra(lower, profile, industryCategory);
  return {
    ...routed,
    reasoning: `${docLabel} sobre una COMPRA → ruteada por contenido como factura de compra: ${routed.reasoning}`,
  };
}

export function routeFacturaCompra(
  lower: string,
  profile: ReturnType<typeof getIndustryProfile>,
  // Se recibe para mantener la firma común de los ruteadores de Layer 4, aunque
  // el ruteo de facturas de compra no la use.
  _industryCategory: IndustryCategory,
): Layer4Result {

  const unconditionalCip = UNCONDITIONAL_CIP_KEYWORDS.filter((kw) => lower.includes(kw));
  if (unconditionalCip.length > 0) {
    return {
      costSection: 'COSTOS_INDIRECTOS',
      confidence: 95,
      requiresAI: false,
      reasoning: `Concepto siempre variable (${unconditionalCip.slice(0, 3).join(', ')}) → Costos Indirectos de Producción por definición de la cátedra, sin excepción de contexto (no se desvía a Materia Prima)`,
    };
  }

  const hasFuel    = /\bgasoil\b|\bcombustible\b|\bnafta\b|\bGNC\b/.test(lower);
  // `energ[íi]a` y no `energia`: el texto llega en minúsculas pero SIN plegar
  // acentos, así que la forma acentuada —la ortográficamente correcta y la que
  // imprime la mayoría de las facturas— no matcheaba.
  const hasEnergy  = /\belectricidad\b|\bluz el[eé]ctrica\b|\bgas natural\b|\benerg[íi]a\b/.test(lower);

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

  const cipKw = [...new Set([...profile.cipKeywords, ...UNIVERSAL_CIP_KEYWORDS])];
  const mpScore  = profile.mpKeywords.filter((kw)  => lower.includes(kw.toLowerCase())).length;
  const cipScore = cipKw.filter((kw) => lower.includes(kw.toLowerCase())).length;
  const modScore = profile.modKeywords.filter((kw) => lower.includes(kw.toLowerCase())).length;

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

  if (modScore > 0 && modScore >= mpScore && modScore >= cipScore) {
    return {
      costSection: 'MANO_DE_OBRA',
      confidence: 80,
      requiresAI: false,
      reasoning: `Factura con indicadores de mano de obra directa (${modScore} señales)`,
    };
  }

  const freightInsuranceMatched = ACQUISITION_INHERENT_KEYWORDS.filter((kw) => lower.includes(kw));
  if (freightInsuranceMatched.length > 0 && mpScore >= 1) {
    const cipCoreScore = cipKw
      .filter((kw) => !ACQUISITION_INHERENT_KEYWORDS.includes(kw.toLowerCase()))
      .filter((kw) => lower.includes(kw.toLowerCase()))
      .length;

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

    return {
      costSection: 'DESCONOCIDO',
      suggestedSection: 'MATERIA_PRIMA',
      confidence: 55,
      requiresAI: true,
      reasoning: `Factura con compra de Materia Prima (${mpScore}) + flete/seguro (${freightInsuranceMatched.join(', ')}) pero también otros Costos Indirectos (${cipCoreScore}) → ambiguo si el flete integra el costo de adquisición o es CIP de planta, requiere análisis por IA`,
    };
  }

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

  return {
    costSection: 'DESCONOCIDO',
    confidence: 50,
    requiresAI: true,
    reasoning: `Sin señales de clasificación suficientes para rubro ${profile.label} → requiere análisis por IA`,
  };
}
