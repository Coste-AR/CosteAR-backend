import type ExcelJS from 'exceljs';
import { cellText } from './xlsx-reader.js';

function normalize(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * `headers` puede ser un array de strings (una sola variante por columna) o
 * un array de arrays (varias variantes aceptadas por columna, en orden).
 */
type HeaderSpec = string | string[];

function headerVariants(spec: HeaderSpec): string[] {
  return (Array.isArray(spec) ? spec : [spec]).map(normalize);
}

/**
 * Busca, en cualquier hoja, una fila cuyas primeras N celdas matcheen (en
 * orden) los encabezados esperados. Si la encuentra, lee las filas de abajo
 * como datos hasta la primera fila completamente vacía (o el final de la
 * hoja). No mezcla con una segunda tabla que tenga el mismo encabezado más
 * abajo — corta en el primer bloque en blanco.
 */
export function findTableByHeaders(wb: ExcelJS.Workbook, headers: HeaderSpec[]): unknown[][] {
  const variants = headers.map(headerVariants);

  for (const ws of wb.worksheets) {
    for (let r = 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const isHeaderRow = variants.every((vs, i) => {
        const text = cellText(row.getCell(i + 1));
        return text !== null && vs.includes(normalize(text));
      });
      if (!isHeaderRow) continue;

      const dataRows: unknown[][] = [];
      for (let dr = r + 1; dr <= ws.rowCount; dr++) {
        const dataRow = ws.getRow(dr);
        const first = cellText(dataRow.getCell(1));
        if (first === null) break; // primera columna vacía → fin de la tabla
        const values: unknown[] = [];
        for (let c = 1; c <= headers.length; c++) {
          const text = cellText(dataRow.getCell(c));
          const matchesNumber = text !== null && /^-?\d+([.,]\d+)?$/.test(text);
          const num = matchesNumber ? Number(text!.replace(',', '.')) : NaN;
          values.push(Number.isFinite(num) ? num : text);
        }
        dataRows.push(values);
      }
      return dataRows;
    }
  }
  return [];
}
