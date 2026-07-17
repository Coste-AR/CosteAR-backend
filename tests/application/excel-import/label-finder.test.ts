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

  it('parsea formato argentino con coma decimal (celda de texto)', async () => {
    const wb = await wbFromRows([['Costo unitario', '1.234,56']]);
    expect(findNumberByLabel(wb, ['Costo unitario'])).toBe(1234.56);
  });

  it('parsea formato argentino negativo con coma decimal (celda de texto)', async () => {
    const wb = await wbFromRows([['Ajuste', '-1.234,56']]);
    expect(findNumberByLabel(wb, ['Ajuste'])).toBe(-1234.56);
  });

  it('parsea un decimal estilo inglés en celda de texto', async () => {
    const wb = await wbFromRows([['Tasa de mantenimiento', '0.3']]);
    expect(findNumberByLabel(wb, ['Tasa de mantenimiento'])).toBe(0.3);
  });

  it('parsea miles con punto sin coma decimal (celda de texto) sin perder 3 órdenes de magnitud', async () => {
    const wb = await wbFromRows([['Demanda anual', '24.000']]);
    expect(findNumberByLabel(wb, ['Demanda anual'])).toBe(24000);
  });

  it('NO trata un decimal chico con cero inicial y 3 decimales como miles', async () => {
    const wb = await wbFromRows([['Tasa de mantenimiento', '0.300']]);
    expect(findNumberByLabel(wb, ['Tasa de mantenimiento'])).toBe(0.3);
  });

  it('NO trata "0.125" (decimal con cero inicial) como miles', async () => {
    const wb = await wbFromRows([['Coeficiente', '0.125']]);
    expect(findNumberByLabel(wb, ['Coeficiente'])).toBe(0.125);
  });

  it('NO trata un decimal negativo con cero inicial como miles', async () => {
    const wb = await wbFromRows([['Ajuste', '-0.030']]);
    expect(findNumberByLabel(wb, ['Ajuste'])).toBe(-0.03);
  });

  // ── Casos encontrados corriendo contra un Excel real de cátedra ─────────
  // (el propio archivo con el que se armó la metodología, no una plantilla
  // nuestra) — cada uno de estos reproduce un problema real, no hipotético.

  it('matchea aunque la redacción real sea más larga y distinta a la etiqueta buscada', async () => {
    // El Excel real dice "Demanda / Consumo Anual Previsto", no "Demanda anual".
    const wb = await wbFromRows([['Demanda / Consumo Anual Previsto', 'R', 24000, 'unidades/año']]);
    expect(findNumberByLabel(wb, ['Demanda anual'])).toBe(24000);
  });

  it('encuentra el valor aunque esté 2 celdas a la derecha, no pegado a la etiqueta', async () => {
    // Layout real: "etiqueta | símbolo | valor | unidad" — el símbolo del
    // medio (ej. "R", "S", "K") no es numérico, hay que mirar más allá.
    const wb = await wbFromRows([['Costo de Emitir una Orden de Compra', 'S', 3500, '$/orden']]);
    expect(findNumberByLabel(wb, ['Costo de orden'])).toBe(3500);
  });

  it('NO matchea si las palabras de la etiqueta aparecen sueltas en una frase larga sin relación', async () => {
    // "Stock Mínimo (sm) = CM·PM + S.Reserva" contiene "stock" y "reserva"
    // igual que "Stock de Reserva", pero es una fórmula distinta — no debe
    // confundirse con el campo real solo porque comparte dos palabras
    // sueltas en un texto mucho más largo.
    const wb = await wbFromRows([
      ['Stock Mínimo (sm) = CM·PM + S.Reserva', 1234],
      ['Stock de Reserva (S.Reserva)', 'Sr', 200, 'unidades'],
    ]);
    expect(findNumberByLabel(wb, ['Stock de reserva'])).toBe(200);
  });

  it('NO extrae un dígito suelto de texto libre como si fuera el valor buscado', async () => {
    // "Hoja 3 — Costos Indirectos de Producción" no es el número 3.
    const wb = await wbFromRows([
      ['Hoja 2 — Mano de Obra Directa', 'Distribución de días del año y tarifa'],
      ['Hoja 3 — Costos Indirectos de Producción', 'Prorrateo primario y secundario'],
    ]);
    expect(findNumberByLabel(wb, ['Días del año'])).toBeNull();
  });

  it('tolera plural/singular y variaciones simples de la palabra (enfermedad/enfermedades)', async () => {
    const wb = await wbFromRows([['Enfermedades Inculpables (prom. histórico)', 5]]);
    expect(findNumberByLabel(wb, ['Enfermedad'])).toBe(5);
  });

  it('cuando dos hojas dan valores distintos, prefiere la que tiene muchos más datos cargados (plantilla vacía al lado de la hoja real)', async () => {
    const wb = new ExcelJS.Workbook();
    const real = wb.addWorksheet('1-MP Ejemplo');
    // Una hoja "real" con bastante contenido cargado alrededor.
    for (let i = 0; i < 15; i++) real.addRow([`Relleno ${i}`, i * 10]);
    real.addRow(['Costo unitario', 800]);

    const plantilla = wb.addWorksheet('1-MP Plantilla');
    // La plantilla vacía: una sola fila con la misma etiqueta pero otro valor.
    plantilla.addRow(['Costo unitario', 1]);

    expect(findNumberByLabel(wb, ['Costo unitario'])).toBe(800);
  });

  it('sigue devolviendo null si las hojas en conflicto tienen cantidades de datos comparables', async () => {
    const wb = new ExcelJS.Workbook();
    const a = wb.addWorksheet('Hoja A');
    a.addRow(['Costo unitario', 800]);
    const b = wb.addWorksheet('Hoja B');
    b.addRow(['Costo unitario', 950]);

    expect(findNumberByLabel(wb, ['Costo unitario'])).toBeNull();
  });
});
