import { loadWorkbook } from './xlsx-reader.js';
import { findNumberByLabel } from './label-finder.js';
import { extractRawMaterial, type PartialRawMaterialConfig } from './extract-raw-material.js';
import { extractDirectLabor, type PartialDirectLaborConfig } from './extract-direct-labor.js';
import { extractIndirectCosts, type PartialIndirectCostConfig } from './extract-indirect-costs.js';

export interface ExcelImportResult {
  rawMaterialConfig?: PartialRawMaterialConfig;
  directLaborConfig?: PartialDirectLaborConfig;
  indirectCostConfig?: PartialIndirectCostConfig;
  sales?: { salesUnitPrice?: number; salesQuantity?: number };
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

/**
 * `true` si `value` no tiene ningún dato real adentro: todo hoja es
 * `undefined` y todo array está vacío. Recorre objetos anidados; un `0`,
 * `false` o `''` en cualquier hoja cuenta como dato DEFINIDO (no vacío) —
 * sólo `undefined` (campo no encontrado en el Excel) cuenta como vacío. Se
 * usa para no devolver secciones "vacías-con-forma" (todo el objeto en
 * `undefined` leaf a leaf) que el frontend interpretaría como "sí hay datos"
 * en vez de activar su fallback a los datos ya guardados.
 */
function isEffectivelyEmpty(value: unknown): boolean {
  if (value === undefined) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object' && value !== null) {
    return Object.values(value).every(isEffectivelyEmpty);
  }
  return false;
}

/** `undefined` si la sección extraída no tiene ningún dato real; si no, la sección tal cual. */
function orUndefinedIfEmpty<T>(section: T): T | undefined {
  return isEffectivelyEmpty(section) ? undefined : section;
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

  const rawMaterialConfig = safeExtract(() => extractRawMaterial(wb), {});
  const directLaborConfig = safeExtract(() => extractDirectLabor(wb), {});
  // A diferencia de los otros dos, `PartialIndirectCostConfig.centers`/`.concepts`
  // no son opcionales (son arrays requeridos, aunque puedan estar vacíos) —
  // el fallback tiene que ser un objeto realmente válido del tipo, no un
  // `{}` casteado a la fuerza que mentiría sobre la forma en runtime.
  const indirectCostConfig = safeExtract(() => extractIndirectCosts(wb), { centers: [], concepts: [] });
  const sales = {
    salesUnitPrice: salesUnitPrice ?? undefined,
    salesQuantity: salesQuantity ?? undefined,
  };

  // Si una sección no trajo NINGÚN dato real (todo undefined / arrays vacíos),
  // se devuelve `undefined` en vez del objeto vacío-con-forma. El frontend
  // hace `importedDefaults?.seccion ?? structure?.seccion` para conservar los
  // datos ya guardados del costista cuando el Excel no traía esa sección —
  // eso sólo funciona si acá devolvemos `undefined` de verdad, no un objeto
  // truthy cuyas hojas están todas en `undefined`.
  return {
    rawMaterialConfig: orUndefinedIfEmpty(rawMaterialConfig),
    directLaborConfig: orUndefinedIfEmpty(directLaborConfig),
    indirectCostConfig: orUndefinedIfEmpty(indirectCostConfig),
    sales: orUndefinedIfEmpty(sales),
  };
}
