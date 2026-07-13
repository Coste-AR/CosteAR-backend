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

  it('cellText devuelve el valor cacheado de una celda esclava de fórmula compartida', async () => {
    // Caso real: una fórmula arrastrada hacia abajo en una columna. ExcelJS
    // representa la celda maestra como { formula, result, ref, shareType } y
    // cada celda esclava del rango como { sharedFormula, result } — sin la
    // propiedad `formula`. cellText debe reconocer ambas formas.
    const buffer = await bufferFromWorkbook((wb) => {
      const ws = wb.addWorksheet('Hoja1');
      ws.getCell('A1').value = 10;
      ws.getCell('A2').value = 20;
      ws.getCell('A3').value = 30;
      ws.fillFormula('B1:B3', 'A1*2', [20, 40, 60]);
    });
    const wb = await loadWorkbook(buffer);
    const ws = wb.worksheets[0]!;
    expect(cellText(ws.getCell('B1'))).toBe('20');
    // B2 y B3 son celdas esclavas: sin este fix, caían en el fallback
    // genérico y devolvían el string "[object Object]".
    expect(cellText(ws.getCell('B2'))).toBe('40');
    expect(cellText(ws.getCell('B3'))).toBe('60');
  });

  it('cellText devuelve null para una celda de error de Excel', async () => {
    const buffer = await bufferFromWorkbook((wb) => {
      const ws = wb.addWorksheet('Hoja1');
      ws.getCell('A1').value = { error: '#DIV/0!' };
    });
    const wb = await loadWorkbook(buffer);
    expect(cellText(wb.worksheets[0]!.getCell('A1'))).toBeNull();
  });

  it('cellText extrae el texto de una celda rich text', async () => {
    const buffer = await bufferFromWorkbook((wb) => {
      const ws = wb.addWorksheet('Hoja1');
      ws.getCell('A1').value = {
        richText: [
          { text: 'Demanda ' },
          { text: 'anual', font: { bold: true } },
        ],
      };
    });
    const wb = await loadWorkbook(buffer);
    expect(cellText(wb.worksheets[0]!.getCell('A1'))).toBe('Demanda anual');
  });

  it('cellText extrae el texto visible de una celda con hipervínculo', async () => {
    const buffer = await bufferFromWorkbook((wb) => {
      const ws = wb.addWorksheet('Hoja1');
      ws.getCell('A1').value = { text: 'Ver planilla', hyperlink: 'https://example.com' };
    });
    const wb = await loadWorkbook(buffer);
    expect(cellText(wb.worksheets[0]!.getCell('A1'))).toBe('Ver planilla');
  });

  it('rechaza un workbook sin hojas', async () => {
    const buffer = await bufferFromWorkbook(() => {});
    await expect(loadWorkbook(buffer)).rejects.toThrow(ValidationError);
  });

  it('cellText devuelve null para una celda nunca definida', async () => {
    const buffer = await bufferFromWorkbook((wb) => {
      const ws = wb.addWorksheet('Hoja1');
      ws.addRow(['Demanda anual', 24000]);
    });
    const wb = await loadWorkbook(buffer);
    const row = wb.worksheets[0]!.getRow(1);
    expect(cellText(row.getCell(9))).toBeNull();
  });
});
