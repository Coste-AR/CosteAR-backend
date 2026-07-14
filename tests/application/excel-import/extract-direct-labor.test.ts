import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { extractDirectLabor } from '../../../src/application/cost-structures/excel-import/extract-direct-labor.js';

describe('extractDirectLabor', () => {
  it('extrae los escalares de días trabajados, ITCS, y la tabla de departamentos', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('2-Mano de Obra');
    ws.addRow(['Total días por año', 365]);
    ws.addRow(['Domingos', 52]);
    ws.addRow(['Sábados', 52]);
    ws.addRow(['Ausencias injustificadas', 3]);
    ws.addRow(['Feriados en fin de semana', 4]);
    ws.addRow(['Feriados', 19]);
    ws.addRow(['Vacaciones', 14]);
    ws.addRow(['Enfermedad', 5]);
    ws.addRow(['Licencias especiales', 2]);
    ws.addRow(['Accidentes de trabajo', 1]);
    ws.addRow(['Base de derivación', 0.27]);
    ws.addRow(['ART fija', 0.015]);
    ws.addRow([]);
    ws.addRow(['Departamento', 'Remun. básica', 'Horas-Hombre']);
    ws.addRow(['Depto Productivo 1', 4500000, 12000]);
    ws.addRow(['Depto Productivo 2', 3200000, 9000]);

    const result = extractDirectLabor(wb);

    expect(result.workingDays).toEqual({
      totalDaysPerYear: 365,
      unpaidAbsence: { sundays: 52, saturdays: 52, unjustifiedAbsences: 3, holidaysOnWeekend: 4 },
      paidAbsence: { holidays: 19, vacations: 14, sickness: 5, specialLeaves: 2, workAccidents: 1 },
    });
    expect(result.itcs).toEqual({ derivationBase: 0.27, fixedArt: 0.015 });
    expect(result.departments).toEqual([
      { name: 'Depto Productivo 1', basicRemuneration: 4500000, hoursWorked: 12000 },
      { name: 'Depto Productivo 2', basicRemuneration: 3200000, hoursWorked: 9000 },
    ]);
  });

  it('extrae la tabla de departamentos cuando las cifras vienen como texto con formato argentino de miles', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('2-Mano de Obra');
    ws.addRow(['Departamento', 'Remun. básica', 'Horas-Hombre']);
    // Celdas de TEXTO (no numéricas nativas), como quedarían si el costista
    // pegó los valores desde otra planilla: "4.500.000" no debe dar NaN, y
    // "1.200" no debe leerse como 1.2 (1000x de error).
    ws.addRow(['Depto Productivo 1', '4.500.000', '12.000']);
    ws.addRow(['Depto Productivo 2', '3.200.000', '1.200']);

    const result = extractDirectLabor(wb);

    expect(result.departments).toEqual([
      { name: 'Depto Productivo 1', basicRemuneration: 4500000, hoursWorked: 12000 },
      { name: 'Depto Productivo 2', basicRemuneration: 3200000, hoursWorked: 1200 },
    ]);
  });
});
