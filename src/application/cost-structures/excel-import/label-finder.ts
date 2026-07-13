import type ExcelJS from 'exceljs';
import { cellText } from './xlsx-reader.js';

function normalize(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, ' ');
}

function toNumber(text: string | null): number | null {
  if (text === null) return null;

  // Si hay coma, es formato argentino: coma es decimal, puntos son miles
  if (text.includes(',')) {
    const cleaned = text.replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '');
    if (!cleaned) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }

  // Sin coma: es formato decimal estándar o número plano
  const cleaned = text.replace(/[^\d.-]/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Busca una etiqueta (una de varias variantes posibles) en cualquier celda de
 * cualquier hoja. Si la encuentra, intenta leer el número en la celda a la
 * derecha; si esa no es numérica, prueba la celda de abajo (mismo layout que
 * usa la ficha de stock del propio export: etiqueta arriba, valor abajo).
 *
 * Si hay más de una coincidencia con valores DISTINTOS, es ambiguo → null
 * (no se adivina cuál es la correcta, va a carga manual).
 */
export function findNumberByLabel(wb: ExcelJS.Workbook, labels: string[]): number | null {
  const wanted = new Set(labels.map(normalize));
  const matches: number[] = [];

  for (const ws of wb.worksheets) {
    ws.eachRow((row, rowNumber) => {
      row.eachCell((cell, colNumber) => {
        const text = cellText(cell);
        if (text === null || !wanted.has(normalize(text))) return;

        const right = toNumber(cellText(row.getCell(colNumber + 1)));
        if (right !== null) {
          matches.push(right);
          return;
        }

        const below = ws.getRow(rowNumber + 1).getCell(colNumber + 1);
        const belowNum = toNumber(cellText(below));
        if (belowNum !== null) matches.push(belowNum);
      });
    });
  }

  if (matches.length === 0) return null;
  const distinct = new Set(matches);
  return distinct.size === 1 ? matches[0]! : null;
}
