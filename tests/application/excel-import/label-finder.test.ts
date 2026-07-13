import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { findNumberByLabel } from '../../../src/application/cost-structures/excel-import/label-finder.js';

async function wbFromRows(rows: unknown[][]): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Hoja1');
  for (const r of rows) ws.addRow(r);
  return wb;
}

describe('findNumberByLabel', () => {
  it('encuentra el valor a la derecha de la etiqueta', async () => {
    const wb = await wbFromRows([['Demanda anual', 24000]]);
    expect(findNumberByLabel(wb, ['Demanda anual'])).toBe(24000);
  });

  it('matchea sin importar mayúsculas ni espacios extra', async () => {
    const wb = await wbFromRows([['  demanda ANUAL  ', 24000]]);
    expect(findNumberByLabel(wb, ['Demanda anual'])).toBe(24000);
  });

  it('prueba varias etiquetas alternativas (sinónimos)', async () => {
    const wb = await wbFromRows([['Costo de pedido', 3500]]);
    expect(findNumberByLabel(wb, ['Costo de orden', 'Costo de pedido'])).toBe(3500);
  });

  it('si la celda a la derecha no es numérica, prueba la de abajo', async () => {
    const wb = await wbFromRows([
      ['Tasa de mantenimiento', 'ver nota'],
      ['', 0.3],
    ]);
    expect(findNumberByLabel(wb, ['Tasa de mantenimiento'])).toBe(0.3);
  });

  it('devuelve null si la etiqueta no aparece en ninguna hoja', async () => {
    const wb = await wbFromRows([['Otra cosa', 100]]);
    expect(findNumberByLabel(wb, ['Demanda anual'])).toBeNull();
  });

  it('devuelve null ante etiquetas ambiguas (dos matches con valores distintos)', async () => {
    const wb = await wbFromRows([
      ['Costo unitario', 800],
      ['Costo unitario', 950],
    ]);
    expect(findNumberByLabel(wb, ['Costo unitario'])).toBeNull();
  });

  it('NO es ambiguo si los dos matches tienen el mismo valor', async () => {
    const wb = await wbFromRows([
      ['Costo unitario', 800],
      ['Costo unitario (repetido en resumen)', 800],
    ]);
    expect(findNumberByLabel(wb, ['Costo unitario'])).toBe(800);
  });
});
