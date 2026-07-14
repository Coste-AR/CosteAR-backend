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

/**
 * Aísla la falla de un extractor de sección para que no tumbe todo el
 * import: si `fn` tira, se resuelve al `fallback` (equivalente vacío del
 * tipo de esa sección) en vez de propagar el error y perder también las
 * secciones que sí se extrajeron bien.
 */
function safeExtract<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

export async function parseExcelImport(buffer: Buffer): Promise<ExcelImportResult> {
  const wb = await loadWorkbook(buffer);

  const salesUnitPrice = findNumberByLabel(wb, ['Precio unitario de venta', 'Precio de venta', 'Precio unitario']);
  // OJO: sin alias genérico 'Cantidad' — colisiona con la columna 'Cantidad'
  // de la Ficha de stock (hoja 1, ver excel-export.ts:92), que trae su propio
  // valor numérico a la derecha (el costo unitario del renglón). Eso vuelve
  // ambiguos los matches y `findNumberByLabel` devuelve null, perdiendo
  // silenciosamente `salesQuantity` en cualquier export→reimport real de
  // CosteAR. 'Cantidad vendida' sola ya matchea el export propio de forma
  // exacta y sin ambigüedad.
  const salesQuantity = findNumberByLabel(wb, ['Cantidad vendida']);

  return {
    rawMaterialConfig: safeExtract(() => extractRawMaterial(wb), {}),
    directLaborConfig: safeExtract(() => extractDirectLabor(wb), {}),
    // A diferencia de los otros dos, `PartialIndirectCostConfig.centers`/`.concepts`
    // no son opcionales (son arrays requeridos, aunque puedan estar vacíos) —
    // el fallback tiene que ser un objeto realmente válido del tipo, no un
    // `{}` casteado a la fuerza que mentiría sobre la forma en runtime.
    indirectCostConfig: safeExtract(() => extractIndirectCosts(wb), { centers: [], concepts: [] }),
    sales: {
      salesUnitPrice: salesUnitPrice ?? undefined,
      salesQuantity: salesQuantity ?? undefined,
    },
  };
}
