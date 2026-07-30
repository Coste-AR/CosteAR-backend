import type ExcelJS from 'exceljs';
import { cellText, cellNumber } from './xlsx-reader.js';
import { toNumber } from './label-finder.js';

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
          const cell = dataRow.getCell(c);
          // Si ExcelJS ya tipó la celda como número, se usa ese valor directo
          // — nunca pasa por el parser de texto ambiguo (ver cellNumber).
          const direct = cellNumber(cell);
          if (direct !== null) { values.push(direct); continue; }

          const text = cellText(cell);
          // Solo se intenta parsear como número si el texto ENTERO tiene forma
          // numérica (dígitos, puntos de miles, coma decimal, signo). Si no se
          // ancla así, `toNumber` (pensado para celdas que ya se sabe que son
          // numéricas) podría extraer dígitos sueltos de un texto como
          // "Depto Productivo 1" y devolver 1 en vez de dejarlo como texto.
          const looksNumeric = text !== null && /^-?[\d.,]+$/.test(text);
          const num = looksNumeric ? toNumber(text) : null;
          values.push(num !== null ? num : text);
        }
        dataRows.push(values);
      }
      return dataRows;
    }
  }
  return [];
}
