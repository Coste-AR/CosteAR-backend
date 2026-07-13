import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { loadWorkbook, cellText } from '../../../src/application/cost-structures/excel-import/xlsx-reader.js';
import { ValidationError } from '../../../src/domain/errors/domain-error.js';

async function bufferFromWorkbook(build: (wb: ExcelJS.Workbook) => void): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  build(wb);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe('xlsx-reader', () => {
  it('carga un workbook válido', async () => {
    const buffer = await bufferFromWorkbook((wb) => {
      const ws = wb.addWorksheet('Hoja1');
      ws.addRow(['Demanda anual', 24000]);
    });
    const wb = await loadWorkbook(buffer);
    expect(wb.worksheets.length).toBe(1);
  });

  it('rechaza un buffer que no es un .xlsx válido', async () => {
    const buffer = Buffer.from('esto no es un excel');
    await expect(loadWorkbook(buffer)).rejects.toThrow(ValidationError);
  });

  it('cellText devuelve el valor cacheado de una celda con fórmula', async () => {
    const buffer = await bufferFromWorkbook((wb) => {
      const ws = wb.addWorksheet('Hoja1');
      const row = ws.addRow(['Total', null]);
      row.getCell(2).value = { formula: 'A1', result: 950000 } as ExcelJS.CellFormulaValue;
    });
    const wb = await loadWorkbook(buffer);
    const cell = wb.worksheets[0]!.getRow(1).getCell(2);
    expect(cellText(cell)).toBe('950000');
  });

  it('cellText devuelve null para fórmula sin valor cacheado', async () => {
    const buffer = await bufferFromWorkbook((wb) => {
      const ws = wb.addWorksheet('Hoja1');
      const row = ws.addRow(['Total', null]);
      row.getCell(2).value = { formula: 'A1' } as ExcelJS.CellFormulaValue;
    });
    const wb = await loadWorkbook(buffer);
    const cell = wb.worksheets[0]!.getRow(1).getCell(2);
    expect(cellText(cell)).toBeNull();
  });

  it('cellText trimea texto y convierte números a string', async () => {
    const buffer = await bufferFromWorkbook((wb) => {
      const ws = wb.addWorksheet('Hoja1');
      ws.addRow(['  Demanda anual  ', 24000]);
    });
    const wb = await loadWorkbook(buffer);
    const row = wb.worksheets[0]!.getRow(1);
    expect(cellText(row.getCell(1))).toBe('Demanda anual');
    expect(cellText(row.getCell(2))).toBe('24000');
  });
});
