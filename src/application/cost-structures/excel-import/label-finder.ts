import type ExcelJS from 'exceljs';
import { cellText, cellNumber } from './xlsx-reader.js';

function normalize(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, ' ');
}

// Palabras que casi no distinguen nada — se ignoran al comparar etiquetas,
// así "Feriados EN fin DE semana" matchea contra "Feriados coincidentes CON
// fin DE semana" (mismas palabras de contenido, distinto conector).
const STOPWORDS = new Set([
  'de', 'del', 'la', 'el', 'los', 'las', 'un', 'una', 'y', 'o', 'a', 'en',
  'con', 'por', 'para', 'al', 'su', 'sus', 'que', 'se',
]);

function contentWords(s: string): string[] {
  return normalize(s)
    .split(/[^a-z0-9áéíóúñ]+/)
    .filter((w) => w.length > 0 && !STOPWORDS.has(w));
}

/**
 * Compara dos palabras tolerando diferencias de género/número/conjugación
 * simples (singular/plural, sustantivo/verbo con la misma raíz) — ej.
 * "enfermedad" vs "enfermedades", "mantenimiento" vs "mantener" comparten
 * los primeros ~5 caracteres. No es un stemmer real, es un atajo barato y
 * explicable: mejor unas pocas coincidencias de más (que el chequeo de
 * ambigüedad de más abajo filtra) que ninguna por un plural.
 */
function wordsMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const MIN_SHARED = 5;
  if (a.length >= MIN_SHARED && b.startsWith(a)) return true;
  if (b.length >= MIN_SHARED && a.startsWith(b)) return true;
  return false;
}

// Cuántas palabras "de relleno" se toleran entre las palabras de contenido
// de la etiqueta dentro de la celda. Sin este límite, una celda larga que
// mencione de pasada las mismas dos palabras sueltas (ej. una fórmula que
// dice "...+ S.Reserva" al final de una frase sobre otra cosa) matchearía
// igual que la etiqueta real — el límite exige que aparezcan razonablemente
// juntas, no en cualquier lugar del texto.
const MAX_FILLER_WORDS = 4;

/**
 * Una etiqueta "matchea" el texto de una celda si TODAS las palabras de
 * contenido de la etiqueta aparecen (tolerando la variación de wordsMatch),
 * razonablemente juntas (dentro de una ventana de `labelWords.length +
 * MAX_FILLER_WORDS` palabras consecutivas), en algún tramo del texto de la
 * celda — no hace falta que sea la frase completa ni el mismo orden exacto.
 * Esto es deliberadamente más permisivo que una igualdad exacta: el costista
 * puede escribir "Demanda / Consumo Anual Previsto" donde nosotros buscamos
 * "Demanda anual", y sigue matcheando porque ambas palabras de contenido
 * están ahí, cerca una de la otra.
 *
 * El costo de ser permisivo lo paga la protección de ambigüedad de
 * `findNumberByLabel`: si esto matchea de más en dos lugares con valores
 * distintos, el resultado es `null` (revisión manual), nunca un número
 * adivinado.
 */
function labelMatchesCell(labelWords: string[], cellWords: string[]): boolean {
  if (labelWords.length === 0) return false;
  const windowSize = labelWords.length + MAX_FILLER_WORDS;
  for (let start = 0; start < cellWords.length; start++) {
    const windowWords = cellWords.slice(start, start + windowSize);
    if (labelWords.every((lw) => windowWords.some((cw) => wordsMatch(lw, cw)))) return true;
  }
  return false;
}

export function toNumber(text: string | null): number | null {
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
  // Importante: NO se aceptan dígitos sueltos dentro de texto libre (ej. "Hoja
  // 3 — Costos Indirectos" no es el número 3). Solo se acepta si el texto
  // COMPLETO, después de sacar espacios y símbolos de moneda/porcentaje, ya
  // es un número — nunca "texto que además tiene un dígito en algún lado".
  const decorationStripped = trimmed.replace(/[\s$%]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(decorationStripped)) return null;
  const n = Number(decorationStripped);
  return Number.isFinite(n) ? n : null;
}

// Cuántas celdas mirar a la derecha (mismo layout que ya cubríamos) y hacia
// abajo (más allá para cubrir "etiqueta | símbolo | valor | unidad", que es
// cómo está armado el Excel real de cátedra: el valor no está pegado a la
// etiqueta, está 2 celdas más allá con la abreviatura de la fórmula en el medio).
const RIGHT_SCAN = 4;
const BELOW_ROWS = 2;

/** Busca el primer número cerca de (rowNumber, colNumber): primero a la
 * derecha en la misma fila, después abajo (misma columna y la de al lado). */
function findNearbyNumber(
  ws: ExcelJS.Worksheet,
  row: ExcelJS.Row,
  rowNumber: number,
  colNumber: number,
): number | null {
  for (let c = colNumber + 1; c <= colNumber + RIGHT_SCAN; c++) {
    const cell = row.getCell(c);
    const n = cellNumber(cell) ?? toNumber(cellText(cell));
    if (n !== null) return n;
  }
  for (let r = rowNumber + 1; r <= rowNumber + BELOW_ROWS; r++) {
    const belowRow = ws.getRow(r);
    for (let c = colNumber; c <= colNumber + 1; c++) {
      const cell = belowRow.getCell(c);
      const n = cellNumber(cell) ?? toNumber(cellText(cell));
      if (n !== null) return n;
    }
  }
  return null;
}

// Cachea cuántas celdas con contenido tiene cada hoja de un workbook — sirve
// para desempatar cuando la misma etiqueta aparece en más de una hoja (ver
// más abajo). Por workbook, no por llamada: se reusa entre los ~20 campos
// que se buscan durante un mismo import.
const sheetFillCache = new WeakMap<ExcelJS.Workbook, Map<ExcelJS.Worksheet, number>>();

function countNonEmptyCells(ws: ExcelJS.Worksheet): number {
  let count = 0;
  ws.eachRow((row) => row.eachCell((cell) => { if (cellText(cell) !== null) count++; }));
  return count;
}

function getSheetFillCounts(wb: ExcelJS.Workbook): Map<ExcelJS.Worksheet, number> {
  let cached = sheetFillCache.get(wb);
  if (!cached) {
    cached = new Map(wb.worksheets.map((ws) => [ws, countNonEmptyCells(ws)]));
    sheetFillCache.set(wb, cached);
  }
  return cached;
}

// Si dos hojas conflictivas aportan valores distintos para la misma
// etiqueta, solo confiamos en la que tiene datos si tiene claramente MÁS
// contenido que la otra (ej. "1-MP Ejemplo" llena vs. "1-MP Plantilla"
// vacía al lado, mismo patrón que ya usa la metodología de cátedra) — no
// alcanza con tener un poco más, tiene que ser una diferencia clara.
const SHEET_DOMINANCE_RATIO = 3;

interface LabelMatch { value: number; sheet: ExcelJS.Worksheet }

/**
 * Busca una etiqueta (una de varias variantes posibles) en cualquier celda de
 * cualquier hoja. El match es por PALABRAS DE CONTENIDO, no frase exacta: si
 * la celda dice "Demanda / Consumo Anual Previsto" y la etiqueta buscada es
 * "Demanda anual", matchea porque ambas palabras están ahí — el costista no
 * tiene por qué redactar igual que nosotros. Encontrada la etiqueta, busca el
 * número más cercano (ver findNearbyNumber) para cubrir tanto layouts
 * "etiqueta | valor" como "etiqueta | símbolo | valor | unidad".
 *
 * Si hay más de una coincidencia con valores DISTINTOS, es ambiguo → null
 * (no se adivina cuál es la correcta, va a carga manual) — SALVO que una de
 * las hojas en conflicto tenga muchos más datos cargados que las demás (ver
 * SHEET_DOMINANCE_RATIO): es el caso típico de un Excel con una hoja
 * "Plantilla" vacía al lado de la hoja real con los datos. Ser permisivo en
 * el match de la etiqueta hace que la ambigüedad sea más frecuente, no que
 * se devuelva un número equivocado — el "no sé" siempre le gana al "adivino".
 */
export function findNumberByLabel(wb: ExcelJS.Workbook, labels: string[]): number | null {
  const wantedWords = labels.map(contentWords).filter((w) => w.length > 0);
  const matches: LabelMatch[] = [];

  for (const ws of wb.worksheets) {
    ws.eachRow((row, rowNumber) => {
      row.eachCell((cell, colNumber) => {
        const text = cellText(cell);
        if (text === null) return;
        const cellWords = contentWords(text);
        const isMatch = wantedWords.some((lw) => labelMatchesCell(lw, cellWords));
        if (!isMatch) return;

        const n = findNearbyNumber(ws, row, rowNumber, colNumber);
        if (n !== null) matches.push({ value: n, sheet: ws });
      });
    });
  }

  if (matches.length === 0) return null;
  const distinctValues = new Set(matches.map((m) => m.value));
  if (distinctValues.size === 1) return matches[0]!.value;

  // Valores distintos por hoja (una hoja puede matchear más de una vez y,
  // en el caso normal, con el mismo valor cada vez — pero si la MISMA hoja
  // ya trae valores en conflicto entre sí, esa hoja no puede ganar por
  // dominancia: es la ambigüedad original de siempre, no una plantilla vacía).
  const bySheet = new Map<ExcelJS.Worksheet, Set<number>>();
  for (const m of matches) {
    const set = bySheet.get(m.sheet) ?? new Set<number>();
    set.add(m.value);
    bySheet.set(m.sheet, set);
  }

  const fillCounts = getSheetFillCounts(wb);
  const ranked = [...bySheet.entries()].sort(
    (a, b) => (fillCounts.get(b[0]) ?? 0) - (fillCounts.get(a[0]) ?? 0),
  );
  const [topSheet, topValues] = ranked[0]!;
  if (topValues.size > 1) return null; // la hoja "ganadora" ya es ambigua sola.

  const runnerUpFill = ranked[1] ? (fillCounts.get(ranked[1][0]) ?? 0) : 0;
  const topFill = fillCounts.get(topSheet) ?? 0;

  return topFill >= runnerUpFill * SHEET_DOMINANCE_RATIO ? [...topValues][0]! : null;
}
