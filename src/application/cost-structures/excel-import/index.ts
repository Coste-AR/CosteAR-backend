import { loadWorkbook } from './xlsx-reader.js';
import { findNumberByLabel } from './label-finder.js';
import { extractRawMaterial, type PartialRawMaterialConfig } from './extract-raw-material.js';
import { extractDirectLabor, type PartialDirectLaborConfig } from './extract-direct-labor.js';
import { extractIndirectCosts, type PartialIndirectCostConfig } from './extract-indirect-costs.js';

export interface ExcelImportResult {
  rawMaterialConfig: PartialRawMaterialConfig;
  directLaborConfig: PartialDirectLaborConfig;
  indirectCostConfig: PartialIndirectCostConfig;
  sales: { salesUnitPrice?: number; salesQuantity?: number };
}

export async function parseExcelImport(buffer: Buffer): Promise<ExcelImportResult> {
  const wb = await loadWorkbook(buffer);

  const salesUnitPrice = findNumberByLabel(wb, ['Precio unitario de venta', 'Precio de venta', 'Precio unitario']);
  const salesQuantity = findNumberByLabel(wb, ['Cantidad vendida', 'Cantidad']);

  return {
    rawMaterialConfig: extractRawMaterial(wb),
    directLaborConfig: extractDirectLabor(wb),
    indirectCostConfig: extractIndirectCosts(wb),
    sales: {
      salesUnitPrice: salesUnitPrice ?? undefined,
      salesQuantity: salesQuantity ?? undefined,
    },
  };
}
