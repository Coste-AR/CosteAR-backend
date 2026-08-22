import ExcelJS from 'exceljs';
import { ValidationError } from '../../../domain/errors/domain-error.js';

/**
 * Lector de celdas seguro para el import de Excel. Todo el código que lee un
 * workbook cargado acá debe pasar los valores de celda por `cellText` —
 * nunca leer `cell.value` directamente — para no reintroducir los casos
 * raros de ExcelJS (fórmulas compartidas, errores, rich text, hipervínculos)
 * que este módulo ya resuelve de forma centralizada.
 */

/** Carga un buffer como workbook de ExcelJS. Tira ValidationError si no es un .xlsx válido. */
export async function loadWorkbook(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  try {
    // El `Buffer` que declara exceljs en su .d.ts es un `interface Buffer
    // extends ArrayBuffer` local al módulo (no el `Buffer` real de Node), lo
    // que rompe la asignación estructural incluso con @types/node
    // deduplicado en todo el árbol de dependencias. Cast angosto y atado al
    // tipo exacto que espera el parámetro (no `any`).
    await wb.xlsx.load(buffer as unknown as Parameters<typeof wb.xlsx.load>[0]);
  } catch {
    throw new ValidationError('El archivo no es un Excel (.xlsx) válido.');
  }
  if (wb.worksheets.length === 0) {
    throw new ValidationError('El Excel no tiene hojas con contenido.');
  }
  return wb;
}

function isErrorValue(v: unknown): v is ExcelJS.CellErrorValue {
  return typeof v === 'object' && v !== null && 'error' in v;
}

/**
 * Texto de una celda: texto plano, número, fecha, fórmula (maestra o
 * compartida) con valor cacheado, rich text o hipervínculo.
 *
 * Nunca evalúa fórmulas: si no hay valor cacheado, o si el valor cacheado es
 * un error de Excel (#DIV/0!, etc.), devuelve null. Las fórmulas
 * "esclavas" de un rango compartido (`fillFormula`) llegan como
 * `{ sharedFormula, result }`, sin la propiedad `formula` — se manejan
 * igual que la fórmula maestra.
 */
export function cellText(cell: ExcelJS.Cell): string | null {
  const v = cell.value;
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();

  if (typeof v === 'object') {
    if ('formula' in v || 'sharedFormula' in v) {
      const result = (v as ExcelJS.CellFormulaValue | ExcelJS.CellSharedFormulaValue).result;
      if (result === undefined || result === null || isErrorValue(result)) return null;
      if (result instanceof Date) return result.toISOString();
      return String(result).trim() || null;
    }
    if (isErrorValue(v)) return null;
    if ('richText' in v) {
      const text = (v as ExcelJS.CellRichTextValue).richText.map((r) => r.text).join('');
      return text.trim() || null;
    }
    if ('hyperlink' in v) {
      const text = (v as ExcelJS.CellHyperlinkValue).text;
      return text === undefined || text === null ? null : String(text).trim() || null;
    }
    // Forma de objeto no reconocida por ExcelJS.CellValue: un null es mucho
    // más seguro que un "[object Object]" silencioso, ya que 8 tareas más
    // del import de Excel dependen de este módulo.
    return null;
  }

  return String(v).trim() || null;
}

/**
 * Da el valor numérico REAL de una celda, cuando ExcelJS ya la tipó como
 * número (o como fórmula cuyo resultado es número) — sin pasar por texto.
 *
 * Por qué existe: `toNumber` (label-finder.ts) interpreta un punto como
 * separador de miles cuando el texto tiene forma "123.456" (grupo de 3
 * dígitos tras el punto). Eso es correcto para texto tipeado a mano
 * ("24.000" = veinticuatro mil), pero una celda numérica real de ExcelJS se
 * stringifica con `String(v)`, que SIEMPRE usa el punto como decimal — un
 * costo unitario real de 123,456 (con 3 decimales, nada raro después de una
 * división) se leía como texto "123.456" y `toNumber` lo inflaba a 123456,
 * sin ningún error ni aviso. Cuando la celda YA es numérica no hace falta
 * adivinar: se usa el valor tal cual.
 */
export function cellNumber(cell: ExcelJS.Cell): number | null {
  const v = cell.value;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (v && typeof v === 'object' && ('formula' in v || 'sharedFormula' in v)) {
    const result = (v as ExcelJS.CellFormulaValue | ExcelJS.CellSharedFormulaValue).result;
    if (typeof result === 'number') return Number.isFinite(result) ? result : null;
  }
  return null;
}
