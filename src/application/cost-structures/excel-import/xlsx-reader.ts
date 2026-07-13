import ExcelJS from 'exceljs';
import { ValidationError } from '../../../domain/errors/domain-error.js';

/** Carga un buffer como workbook de ExcelJS. Tira ValidationError si no es un .xlsx válido. */
export async function loadWorkbook(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch {
    throw new ValidationError('El archivo no es un Excel (.xlsx) válido.');
  }
  if (wb.worksheets.length === 0) {
    throw new ValidationError('El Excel no tiene hojas con contenido.');
  }
  return wb;
}

/**
 * Texto de una celda, sea texto plano, número, o fórmula con valor cacheado.
 * Fórmula sin valor cacheado → null (nunca se evalúa la fórmula acá).
 */
export function cellText(cell: ExcelJS.Cell): string | null {
  const v = cell.value;
  if (v === null || v === undefined) return null;
  if (typeof v === 'object' && 'formula' in v) {
    const result = (v as ExcelJS.CellFormulaValue).result;
    if (result === undefined || result === null) return null;
    return String(result).trim();
  }
  if (v instanceof Date) return v.toISOString();
  return String(v).trim() || null;
}
