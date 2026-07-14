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

  it('descarta (no adivina 0) un concepto cuyo fijo o variable no se pudo parsear como número', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('3-Costos Indirectos');
    ws.addRow(['Centro de costo', 'Tipo']);
    ws.addRow(['Armado', 'Productivo']);
    ws.addRow([]);
    ws.addRow(['Concepto', 'Fijo', 'Variable']);
    ws.addRow(['Alquiler', 300000, 0]);
    ws.addRow(['Seguro', 'a confirmar', 50000]);
    ws.addRow(['Energía', 0, 180000]);

    const result = extractIndirectCosts(wb);

    expect(result.concepts).toEqual([
      { name: 'Alquiler', amount: { fixed: 300000, variable: 0 }, distribution: {} },
      { name: 'Energía', amount: { fixed: 0, variable: 180000 }, distribution: {} },
    ]);
    expect(result.concepts.find((c) => c.name === 'Seguro')).toBeUndefined();
  });

  it('desambigua ids cuando dos filas de centro slugifican al mismo id', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('3-Costos Indirectos');
    ws.addRow(['Centro de costo', 'Tipo']);
    ws.addRow(['Armado', 'Productivo']);
    ws.addRow(['Armado', 'Productivo']); // nombre repetido exacto (p.ej. fila duplicada al pegar)
    ws.addRow(['Depósito', 'Servicio']);
    ws.addRow(['DEPÓSITO', 'Servicio']); // mismo slug vía normalización de mayúsculas

    const result = extractIndirectCosts(wb);

    expect(result.centers).toEqual([
      { id: 'armado', name: 'Armado', type: 'productive' },
      { id: 'armado-2', name: 'Armado', type: 'productive' },
      { id: 'deposito', name: 'Depósito', type: 'service' },
      { id: 'deposito-2', name: 'DEPÓSITO', type: 'service' },
    ]);
    const ids = result.centers.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
