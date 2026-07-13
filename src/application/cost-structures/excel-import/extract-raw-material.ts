import type ExcelJS from 'exceljs';
import { findNumberByLabel } from './label-finder.js';

export interface PartialRawMaterialConfig {
  wilson?: {
    annualDemand?: number; orderCost?: number; holdingRate?: number; unitCost?: number;
  };
  stockPolicy?: {
    minConsumption?: number; maxConsumption?: number;
    minLeadTime?: number; maxLeadTime?: number; safetyStock?: number;
  };
  initialStock?: { quantity?: number; unitCost?: number };
}

function orUndef(n: number | null): number | undefined {
  return n === null ? undefined : n;
}

export function extractRawMaterial(wb: ExcelJS.Workbook): PartialRawMaterialConfig {
  const unitCost = orUndef(findNumberByLabel(wb, ['Costo unitario']));
  return {
    wilson: {
      annualDemand: orUndef(findNumberByLabel(wb, ['Demanda anual'])),
      orderCost: orUndef(findNumberByLabel(wb, ['Costo de orden', 'Costo de pedido'])),
      holdingRate: orUndef(findNumberByLabel(wb, ['Tasa de mantenimiento'])),
      unitCost,
    },
    stockPolicy: {
      minConsumption: orUndef(findNumberByLabel(wb, ['Consumo mínimo'])),
      maxConsumption: orUndef(findNumberByLabel(wb, ['Consumo máximo'])),
      minLeadTime: orUndef(findNumberByLabel(wb, ['Plazo mínimo', 'Plazo de reposición mínimo'])),
      maxLeadTime: orUndef(findNumberByLabel(wb, ['Plazo máximo', 'Plazo de reposición máximo'])),
      safetyStock: orUndef(findNumberByLabel(wb, ['Stock de reserva', 'Stock de seguridad'])),
    },
    initialStock: {
      quantity: orUndef(findNumberByLabel(wb, ['Existencia inicial'])),
      unitCost,
    },
  };
}
