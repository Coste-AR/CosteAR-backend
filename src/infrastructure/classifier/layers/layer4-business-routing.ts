import type { DocumentType, CostSection, IndustryCategory, AcquisitionCostLink } from '../types.js';
import { getIndustryProfile } from '../industry/industry-profile.js';
import { routePayroll } from './layer4-payroll-routing.js';
import { routeNota, routeFacturaCompra } from './layer4-invoice-routing.js';

export interface Layer4Result {
  costSection: CostSection;
  confidence: number;
  requiresAI: boolean;
  reasoning: string;
  suggestedSection?: CostSection;
  /**
   * Presente cuando el documento declara ser un flete/seguro sobre una compra
   * (ver `AcquisitionCostLink` en types.ts). Viaja hasta el resultado final para
   * que la capa de aplicación pueda resolver el vínculo contra el libro.
   */
  acquisitionLink?: AcquisitionCostLink;
}

export function runLayer4(
  documentType: DocumentType | string,
  text: string,
  industryCategory: IndustryCategory = 'DEFAULT',
  extractedRole?: string | null,
): Layer4Result {
  const lower = text.toLowerCase();
  const profile = getIndustryProfile(industryCategory);

  switch (documentType) {
    case 'LIQUIDACION_MOD':
    case 'PLANILLA_HORAS':
      return routePayroll(text, extractedRole);

    case 'FACTURA_VENTA':
      return {
        costSection: 'VENTAS',
        confidence: 99,
        requiresAI: false,
        reasoning: 'Factura de venta emitida → Ventas',
      };

    case 'NOTA_DEBITO':
    case 'NOTA_CREDITO':
      return routeNota(
        documentType === 'NOTA_CREDITO' ? 'Nota de crédito' : 'Nota de débito',
        lower,
        profile,
        industryCategory,
      );

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
