import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { extractIndirectCosts } from '../../../src/application/cost-structures/excel-import/extract-indirect-costs.js';

describe('extractIndirectCosts', () => {
  it('extrae centros de costo y conceptos, con distribución vacía a completar a mano', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('3-Costos Indirectos');
    ws.addRow(['Centro de costo', 'Tipo']);
    ws.addRow(['Armado', 'Productivo']);
    ws.addRow(['Pintura', 'Productivo']);
    ws.addRow(['Mantenimiento', 'Servicio']);
    ws.addRow([]);
    ws.addRow(['Concepto', 'Fijo', 'Variable']);
    ws.addRow(['Alquiler', 300000, 0]);
    ws.addRow(['Energía', 0, 180000]);

    const result = extractIndirectCosts(wb);

    expect(result.centers).toEqual([
      { id: 'armado', name: 'Armado', type: 'productive' },
      { id: 'pintura', name: 'Pintura', type: 'productive' },
      { id: 'mantenimiento', name: 'Mantenimiento', type: 'service' },
    ]);
    expect(result.concepts).toEqual([
      { name: 'Alquiler', amount: { fixed: 300000, variable: 0 }, distribution: {} },
      { name: 'Energía', amount: { fixed: 0, variable: 180000 }, distribution: {} },
    ]);
  });
});
