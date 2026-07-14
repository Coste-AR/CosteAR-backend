import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { parseExcelImport } from '../../../src/application/cost-structures/excel-import/index.js';

/** Arma un fixture con TODOS los campos, usando los valores reales de prisma/seed.mjs. */
async function fullFixtureBuffer(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();

  const mp = wb.addWorksheet('1-Materia Prima');
  mp.addRow(['Demanda anual', 24000]);
  mp.addRow(['Costo de orden', 3500]);
  mp.addRow(['Tasa de mantenimiento', 0.3]);
  mp.addRow(['Costo unitario', 800]);
  mp.addRow(['Consumo mínimo', 40]);
  mp.addRow(['Consumo máximo', 90]);
  mp.addRow(['Plazo mínimo', 8]);
  mp.addRow(['Plazo máximo', 12]);
  mp.addRow(['Stock de reserva', 200]);
  mp.addRow(['Existencia inicial', 300]);

  const mod = wb.addWorksheet('2-Mano de Obra');
  mod.addRow(['Total días por año', 365]);
  mod.addRow(['Domingos', 52]);
  mod.addRow(['Sábados', 52]);
  mod.addRow(['Ausencias injustificadas', 3]);
  mod.addRow(['Feriados en fin de semana', 4]);
  mod.addRow(['Feriados', 19]);
  mod.addRow(['Vacaciones', 14]);
  mod.addRow(['Enfermedad', 5]);
  mod.addRow(['Licencias especiales', 2]);
  mod.addRow(['Accidentes de trabajo', 1]);
  mod.addRow(['Base de derivación', 0.27]);
  mod.addRow(['ART fija', 0.015]);
  mod.addRow([]);
  mod.addRow(['Departamento', 'Remun. básica', 'Horas-Hombre']);
  mod.addRow(['Departamento Productivo 1', 4500000, 12000]);

  const cip = wb.addWorksheet('3-Costos Indirectos');
  cip.addRow(['Centro de costo', 'Tipo']);
  cip.addRow(['Armado', 'Productivo']);
  cip.addRow(['Mantenimiento', 'Servicio']);
  cip.addRow([]);
  cip.addRow(['Concepto', 'Fijo', 'Variable']);
  cip.addRow(['Alquiler', 300000, 0]);

  const ventas = wb.addWorksheet('4-Estado de Costos');
  ventas.addRow(['Precio unitario de venta', 12000]);
  ventas.addRow(['Cantidad vendida', 1200]);

  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe('parseExcelImport', () => {
  it('combina los cuatro extractores en un solo resultado', async () => {
    const buffer = await fullFixtureBuffer();
    const result = await parseExcelImport(buffer);

    expect(result.rawMaterialConfig?.wilson?.annualDemand).toBe(24000);
    expect(result.directLaborConfig?.departments?.[0]?.name).toBe('Departamento Productivo 1');
    expect(result.indirectCostConfig?.centers).toHaveLength(2);
    expect(result.sales).toEqual({ salesUnitPrice: 12000, salesQuantity: 1200 });
  });

  it('tira ValidationError si el buffer no es un .xlsx válido', async () => {
    await expect(parseExcelImport(Buffer.from('no es excel'))).rejects.toThrow();
  });
});
