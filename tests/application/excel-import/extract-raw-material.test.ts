import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { extractRawMaterial } from '../../../src/application/cost-structures/excel-import/extract-raw-material.js';

describe('extractRawMaterial', () => {
  it('extrae los parámetros de Wilson y la política de stock por etiqueta', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('1-Materia Prima');
    ws.addRow(['Demanda anual', 24000]);
    ws.addRow(['Costo de orden', 3500]);
    ws.addRow(['Tasa de mantenimiento', 0.3]);
    ws.addRow(['Costo unitario', 800]);
    ws.addRow(['Consumo mínimo', 40]);
    ws.addRow(['Consumo máximo', 90]);
    ws.addRow(['Plazo mínimo', 8]);
    ws.addRow(['Plazo máximo', 12]);
    ws.addRow(['Stock de reserva', 200]);
    ws.addRow(['Existencia inicial', 300]);

    const result = extractRawMaterial(wb);

    expect(result.wilson).toEqual({
      annualDemand: 24000, orderCost: 3500, holdingRate: 0.3, unitCost: 800,
    });
    expect(result.stockPolicy).toEqual({
      minConsumption: 40, maxConsumption: 90, minLeadTime: 8, maxLeadTime: 12, safetyStock: 200,
    });
    expect(result.initialStock).toEqual({ quantity: 300, unitCost: 800 });
  });

  it('deja los campos no encontrados en undefined en vez de inventar un valor', async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Vacía');
    const result = extractRawMaterial(wb);
    expect(result.wilson?.annualDemand).toBeUndefined();
  });

  it('reconoce las etiquetas con sufijo de variable de fórmula del propio export de CosteAR', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('1-Materia Prima');
    ws.addRow(['Demanda anual (R)', 24000]);
    ws.addRow(['Costo de orden (S)', 3500]);
    ws.addRow(['Tasa de mantenimiento (K)', 0.3]);
    ws.addRow(['Costo unitario (C)', 800]);
    ws.addRow(['Existencia inicial', 300]);

    const result = extractRawMaterial(wb);

    expect(result.wilson).toEqual({
      annualDemand: 24000, orderCost: 3500, holdingRate: 0.3, unitCost: 800,
    });
    expect(result.initialStock).toEqual({ quantity: 300, unitCost: 800 });
  });
});
