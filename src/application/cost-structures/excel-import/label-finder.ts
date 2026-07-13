import type ExcelJS from 'exceljs';
import { cellText } from './xlsx-reader.js';

function normalize(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, ' ');
}

function toNumber(text: string | null): number | null {
  if (text === null) return null;
  const trimmed = text.trim();
  if (trimmed === '') return null;

  // Coma decimal (formato argentino: "1.234,56") — los puntos son miles, la coma es el decimal.
  if (trimmed.includes(',')) {
    const cleaned = trimmed.replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '');
    if (!cleaned) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }

  // Sin coma pero con puntos en forma de miles exacta ("24.000", "1.234.567")
  // y SIN resto decimal → los puntos son miles, no un punto decimal. El
  // primer grupo no puede empezar con 0: un número agrupado por miles nunca
  // arranca con cero ("0.300" es el decimal 0,3, no el entero 300).
  if (/^-?[1-9]\d{0,2}(\.\d{3})+$/.test(trimmed)) {
    const n = Number(trimmed.replace(/\./g, ''));
    return Number.isFinite(n) ? n : null;
  }

  // Sin coma, sin forma de miles → punto decimal normal ("0.3", "24000", "3500.75").
  const cleaned = trimmed.replace(/[^\d.-]/g, '');
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
