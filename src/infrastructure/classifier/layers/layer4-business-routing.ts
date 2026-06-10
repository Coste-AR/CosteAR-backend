import type { DocumentType, CostSection } from '../types.js';

export interface Layer4Result {
  costSection: CostSection;
  confidence: number;
  requiresAI: boolean;
}

const MP_KEYWORDS = [
  'materia prima', 'insumo', 'material', ' kg', 'litro', 'tonelada',
  'bobina', 'rollo', 'envase', 'embalaje', 'chapa', 'alambre', 'tela', 'hilo',
  'resina', 'pintura', 'solvente', 'madera', 'cartón', 'plástico',
];

const CIP_KEYWORDS = [
  'alquiler', 'alq.', 'servicio', 'energía', 'energia', 'electricidad',
  'gas', 'mantenimiento', 'mant.', 'seguro', 'limpieza', 'vigilancia',
  'telefonía', 'telefonia', 'internet', 'agua', 'abono', 'cuota',
  'reparacion', 'reparación', 'repuesto', 'herramienta',
];

/**
 * Layer 4: Business Routing.
 * Determines which cost section a classified document belongs to.
 */
export function runLayer4(documentType: DocumentType | string, text: string): Layer4Result {
  const lower = text.toLowerCase();

  switch (documentType) {
    case 'LIQUIDACION_MOD':
    case 'PLANILLA_HORAS':
      return { costSection: 'MANO_DE_OBRA', confidence: 99, requiresAI: false };

    case 'FACTURA_VENTA':
      return { costSection: 'VENTAS', confidence: 99, requiresAI: false };

    case 'REMITO': {
      if (/\brecibimos\b|\bentrada\b|\bcompra\b/i.test(text)) {
        return { costSection: 'MATERIA_PRIMA', confidence: 80, requiresAI: false };
      }
      if (/\bdespachamos\b|\bsalida\b|\bventa\b/i.test(text)) {
        return { costSection: 'VENTAS', confidence: 80, requiresAI: false };
      }
      return { costSection: 'DESCONOCIDO', confidence: 50, requiresAI: true };
    }

    case 'NOTA_DEBITO':
    case 'NOTA_CREDITO':
      return { costSection: 'COSTOS_INDIRECTOS', confidence: 85, requiresAI: false };

    case 'FACTURA_COMPRA': {
      const mpScore = MP_KEYWORDS.filter((kw) => lower.includes(kw)).length;
      const cipScore = CIP_KEYWORDS.filter((kw) => lower.includes(kw)).length;

      if (mpScore > cipScore && mpScore >= 1) {
        return { costSection: 'MATERIA_PRIMA', confidence: 82 + Math.min(mpScore * 3, 15), requiresAI: false };
      }
      if (cipScore > mpScore && cipScore >= 1) {
        return { costSection: 'COSTOS_INDIRECTOS', confidence: 82 + Math.min(cipScore * 3, 15), requiresAI: false };
      }
      return { costSection: 'DESCONOCIDO', confidence: 50, requiresAI: true };
    }

    default:
      return { costSection: 'DESCONOCIDO', confidence: 0, requiresAI: true };
  }
}
