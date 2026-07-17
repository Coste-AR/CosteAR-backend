import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { findTableByHeaders } from '../../../src/application/cost-structures/excel-import/table-finder.js';

async function wbFromRows(rows: unknown[][]): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Hoja1');
  for (const r of rows) ws.addRow(r);
  return wb;
}

describe('findTableByHeaders', () => {
  it('encuentra una tabla por sus encabezados y lee las filas hasta la primera fila vacía', async () => {
    const wb = await wbFromRows([
      ['algo antes', ''],
      ['Departamento', 'Remun. básica', 'Horas-Hombre'],
      ['Depto Productivo 1', 4500000, 12000],
      ['Depto Productivo 2', 3200000, 9000],
      [],
      ['otra cosa después'],
    ]);
    const rows = findTableByHeaders(wb, ['Departamento', 'Remun. básica', 'Horas-Hombre']);
    expect(rows).toEqual([
      ['Depto Productivo 1', 4500000, 12000],
      ['Depto Productivo 2', 3200000, 9000],
    ]);
  });

  it('matchea encabezados con variantes de nombre (sinónimos por columna)', async () => {
    const wb = await wbFromRows([
      ['Departamento', 'Remuneración básica', 'Horas trabajadas'],
      ['Depto A', 100, 200],
    ]);
    const rows = findTableByHeaders(wb, [
      ['Departamento'],
      ['Remun. básica', 'Remuneración básica'],
      ['Horas-Hombre', 'Horas trabajadas'],
    ]);
    expect(rows).toEqual([['Depto A', 100, 200]]);
  });

  it('devuelve [] si no encuentra la fila de encabezados', async () => {
    const wb = await wbFromRows([['Nada que ver', 'con la tabla']]);
    expect(findTableByHeaders(wb, ['Departamento', 'Remun. básica', 'Horas-Hombre'])).toEqual([]);
  });

  it('para de leer en la primera fila totalmente vacía, no sigue hasta el final de la hoja', async () => {
    const wb = await wbFromRows([
      ['Concepto', 'Fijo', 'Variable'],
      ['Alquiler', 300000, 0],
      [],
      ['Concepto', 'Fijo', 'Variable'], // otra tabla más abajo, no se mezcla
      ['Energía', 0, 180000],
    ]);
    const rows = findTableByHeaders(wb, ['Concepto', 'Fijo', 'Variable']);
    expect(rows).toEqual([['Alquiler', 300000, 0]]);
  });

  it('parsea celdas numéricas con coma decimal como número, sin devolver NaN', async () => {
    const wb = await wbFromRows([
      ['Departamento', 'Remun. básica', 'Horas-Hombre'],
      ['Depto A', 100, '4,5'],
    ]);
    const rows = findTableByHeaders(wb, ['Departamento', 'Remun. básica', 'Horas-Hombre']);
    expect(rows).toEqual([['Depto A', 100, 4.5]]);
  });

  it('parsea celdas de TEXTO con formato argentino de miles (puntos), sin NaN ni 1000x de error', async () => {
    // Celdas de texto (no numéricas nativas) con puntos de miles: "4.500.000"
    // debe leerse como 4500000 (no NaN), y "1.200" como 1200 (no 1.2).
    const wb = await wbFromRows([
      ['Departamento', 'Remun. básica', 'Horas-Hombre'],
      ['Depto A', '4.500.000', '1.200'],
    ]);
    const rows = findTableByHeaders(wb, ['Departamento', 'Remun. básica', 'Horas-Hombre']);
    expect(rows).toEqual([['Depto A', 4500000, 1200]]);
  });

  it('no corrompe el nombre de una fila con dígitos (ej. "Depto Productivo 1") al intentar parsearlo como número', async () => {
    const wb = await wbFromRows([
      ['Departamento', 'Remun. básica', 'Horas-Hombre'],
      ['Depto Productivo 1', 4500000, 12000],
    ]);
    const rows = findTableByHeaders(wb, ['Departamento', 'Remun. básica', 'Horas-Hombre']);
    expect(rows).toEqual([['Depto Productivo 1', 4500000, 12000]]);
  });
});
