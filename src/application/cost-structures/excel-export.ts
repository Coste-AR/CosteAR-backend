import ExcelJS from 'exceljs';
import {
  rawMaterialConfigSchema,
  directLaborConfigSchema,
  indirectCostConfigSchema,
} from '../../shared/schemas/cost.schema.js';
import { runCalculation, type CalculationInput } from './calculate.js';

/**
 * Exporta una estructura de costos a un archivo .xlsx con la estética de
 * CosteAR (granate). Incluye los datos de entrada de los tres elementos y la
 * hoja de resultado (Estado de Costos + margen). El costista puede abrirlo en
 * Excel o Google Sheets y seguir trabajando — el concepto "exoesqueleto".
 *
 * El Estado de Costos (hoja 4) usa fórmulas de Excel reales que referencian
 * las celdas de resultado de las hojas 1-3: si el costista corrige un dato en
 * MP/MOD/CIP, los totales de la hoja 4 se recalculan solos. Los resultados de
 * Wilson/ITCS/CIP en sí (prorrateo primario y secundario, derivación de ITCS)
 * NO se reproducen como fórmulas — son las partes más intrincadas del motor
 * de cálculo, ya testeadas en el backend, y portarlas a fórmulas de Excel
 * tendría riesgo real de divergir silenciosamente del motor real. Se exportan
 * como el valor ya calculado, dejando la hoja 4 como el nivel que sí queda
 * "vivo" para el costista.
 */

const GRANATE = 'FF6E1423';
const GRANATE_TENUE = 'FFF6EBEC';
const INK = 'FF16181D';

interface StructureForExport {
  productName: string;
  period: string;
  companyName: string;
  rawMaterialConfig: unknown;
  directLaborConfig: unknown;
  indirectCostConfig: unknown;
  salesUnitPrice: number;
  salesQuantity: number;
}

function styleHeader(row: ExcelJS.Row): void {
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Arial' };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRANATE } };
    cell.alignment = { vertical: 'middle' };
  });
}

function titleRow(ws: ExcelJS.Worksheet, text: string): void {
  const row = ws.addRow([text]);
  row.font = { bold: true, size: 13, color: { argb: GRANATE }, name: 'Arial' };
  ws.addRow([]);
}

const MONEY_FMT = '"$"#,##0.00';

/** Referencia de celda entre hojas para una fórmula de ExcelJS. */
function ref(sheetName: string, row: number, col: 'A' | 'B' | 'C' | 'D' = 'B'): string {
  return `'${sheetName}'!${col}${row}`;
}

export async function exportCostStructureToXlsx(
  s: StructureForExport,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'CosteAR';
  wb.created = new Date();

  // Portada
  const cover = wb.addWorksheet('Portada');
  cover.columns = [{ width: 28 }, { width: 40 }];
  cover.addRow(['CosteAR']).font = { bold: true, size: 20, color: { argb: GRANATE }, name: 'Arial' };
  cover.addRow(['Estructura de costos exportada']);
  cover.addRow([]);
  cover.addRow(['Empresa', s.companyName]);
  cover.addRow(['Producto', s.productName]);
  cover.addRow(['Período', s.period]);
  cover.addRow(['Generado', new Date().toLocaleString('es-AR')]);

  // --- Materia Prima ---
  const rm = rawMaterialConfigSchema.parse(s.rawMaterialConfig);
  const mpSheetName = '1-Materia Prima';
  const mp = wb.addWorksheet(mpSheetName);
  mp.columns = [{ width: 36 }, { width: 16 }, { width: 16 }, { width: 16 }];
  titleRow(mp, 'HOJA 1 · Materia Prima');
  styleHeader(mp.addRow(['Parámetro (Wilson)', 'Valor']));
  mp.addRow(['Demanda anual (R)', rm.wilson.annualDemand]);
  mp.addRow(['Costo de orden (S)', rm.wilson.orderCost]);
  mp.addRow(['Tasa de mantenimiento (K)', rm.wilson.holdingRate]);
  mp.addRow(['Costo unitario (C)', rm.wilson.unitCost]);
  mp.addRow([]);
  styleHeader(mp.addRow(['Ficha de stock', 'Cantidad', 'Costo Unit.', 'Tipo']));
  mp.addRow(['Existencia inicial', rm.initialStock.quantity, rm.initialStock.unitCost, 'inicial']);
  for (const m of rm.movements) {
    mp.addRow([m.detail, m.quantity, m.unitCost ?? '', m.type === 'purchase' ? 'compra' : 'consumo']);
  }

  // --- Mano de Obra Directa ---
  const dl = directLaborConfigSchema.parse(s.directLaborConfig);
  const modSheetName = '2-Mano de Obra';
  const mod = wb.addWorksheet(modSheetName);
  mod.columns = [{ width: 36 }, { width: 18 }, { width: 16 }];
  titleRow(mod, 'HOJA 2 · Mano de Obra Directa');
  styleHeader(mod.addRow(['Departamento', 'Remun. básica', 'Horas-Hombre']));
  for (const d of dl.departments) {
    mod.addRow([d.name, d.basicRemuneration, d.hoursWorked]);
  }
  mod.addRow([]);
  styleHeader(mod.addRow(['Componente ITCS', 'Coeficiente']));
  mod.addRow(['Base de derivación', dl.itcs.derivationBase]);
  mod.addRow(['ART fija', dl.itcs.fixedArt]);
  for (const c of dl.itcs.uncertainRemunerative) mod.addRow([c.name, c.coefficient]);
  for (const c of dl.itcs.uncertainNonRemunerative) mod.addRow([c.name, c.coefficient]);

  // --- Costos Indirectos ---
  const ic = indirectCostConfigSchema.parse(s.indirectCostConfig);
  const cipSheetName = '3-Costos Indirectos';
  const cip = wb.addWorksheet(cipSheetName);
  cip.columns = [{ width: 28 }, { width: 16 }, { width: 16 }, { width: 16 }];
  titleRow(cip, 'HOJA 3 · Costos Indirectos');
  styleHeader(cip.addRow(['Concepto', 'Fijo', 'Variable', 'Total']));
  for (const c of ic.concepts) {
    const row = cip.addRow([c.name, c.amount.fixed, c.amount.variable]);
    // Total por concepto: fórmula simple (fijo + variable), segura de reproducir.
    row.getCell(4).value = { formula: `B${row.number}+C${row.number}` };
    row.getCell(4).numFmt = MONEY_FMT;
  }

  // --- Cálculo (motor real, para los valores derivados que no se reproducen como fórmula) ---
  const input: CalculationInput = {
    rawMaterial: rm,
    directLabor: dl,
    indirectCosts: ic,
    inventory: { initialWorkInProcess: 0, finalWorkInProcess: 0, initialFinishedGoods: 0, finalFinishedGoods: 0 },
    sales: { unitPrice: s.salesUnitPrice, quantity: s.salesQuantity },
  };
  const result = runCalculation(input);

  // Resultado de MP: se agrega al pie de la hoja 1, como valor de referencia
  // (la ficha PPP completa no se reproduce como fórmula — ver nota arriba).
  mp.addRow([]);
  styleHeader(mp.addRow(['Resultado', 'Valor']));
  const mpConsumedRow = mp.addRow(['Materia Prima Consumida (PPP)', result.rawMaterialConsumed]);
  mpConsumedRow.getCell(2).numFmt = MONEY_FMT;
  mpConsumedRow.getCell(2).font = { bold: true, name: 'Consolas' };

  // Resultado de MOD: idem, al pie de la hoja 2.
  mod.addRow([]);
  styleHeader(mod.addRow(['Resultado', 'Valor']));
  const modTotalRow = mod.addRow(['Total Mano de Obra Directa', result.directLaborTotal]);
  modTotalRow.getCell(2).numFmt = MONEY_FMT;
  modTotalRow.getCell(2).font = { bold: true, name: 'Consolas' };

  // Resultado de CIP: idem, al pie de la hoja 3 (el prorrateo primario/secundario
  // que produce este número no se reproduce como fórmula).
  cip.addRow([]);
  styleHeader(cip.addRow(['Resultado', 'Valor']));
  const cipTotalRow = cip.addRow(['Total CIP Aplicado', result.indirectCostsApplied]);
  cipTotalRow.getCell(2).numFmt = MONEY_FMT;
  cipTotalRow.getCell(2).font = { bold: true, name: 'Consolas' };

  // --- Resultado (Estado de Costos) — con fórmulas reales, referenciando las
  // celdas de resultado de las hojas 1-3. Este es el nivel que sí queda "vivo".
  const res = wb.addWorksheet('4-Estado de Costos');
  res.columns = [{ width: 40 }, { width: 20 }];
  titleRow(res, 'HOJA 4 · Estado de Costos');

  styleHeader(res.addRow(['Venta', 'Valor']));
  const priceRow = res.addRow(['Precio unitario de venta', s.salesUnitPrice]);
  priceRow.getCell(2).numFmt = MONEY_FMT;
  const qtyRow = res.addRow(['Cantidad vendida', s.salesQuantity]);
  const salesRow = res.addRow(['Ventas totales', 0]);
  salesRow.getCell(2).value = { formula: `B${priceRow.number}*B${qtyRow.number}` };
  salesRow.getCell(2).numFmt = MONEY_FMT;
  salesRow.getCell(2).font = { bold: true, name: 'Consolas' };
  res.addRow([]);

  styleHeader(res.addRow(['Elemento del costo', 'Valor']));
  const mpRow = res.addRow(['Materia Prima consumida', 0]);
  mpRow.getCell(2).value = { formula: ref(mpSheetName, mpConsumedRow.number) };
  const modRow = res.addRow(['Mano de Obra Directa', 0]);
  modRow.getCell(2).value = { formula: ref(modSheetName, modTotalRow.number) };
  const cipRow = res.addRow(['CIP aplicados', 0]);
  cipRow.getCell(2).value = { formula: ref(cipSheetName, cipTotalRow.number) };
  for (const row of [mpRow, modRow, cipRow]) row.getCell(2).numFmt = MONEY_FMT;

  const prodCostRow = res.addRow(['COSTO DE PRODUCCIÓN', 0]);
  prodCostRow.getCell(2).value = { formula: `B${mpRow.number}+B${modRow.number}+B${cipRow.number}` };

  // COGS = Costo de Producción (no hay tracking de inventario WIP/PT en la app
  // hoy — si se agrega en el futuro, esta fórmula es el lugar para sumarlo).
  const cogsRow = res.addRow(['COSTO DE PRODUCTOS VENDIDOS', 0]);
  cogsRow.getCell(2).value = { formula: `B${prodCostRow.number}` };

  const marginRow = res.addRow(['Margen bruto', 0]);
  marginRow.getCell(2).value = { formula: `B${salesRow.number}-B${cogsRow.number}` };

  for (const row of [prodCostRow, cogsRow, marginRow]) {
    row.getCell(2).numFmt = MONEY_FMT;
    row.eachCell((c, colNumber) => {
      c.font = { bold: true, color: { argb: INK }, name: colNumber === 2 ? 'Consolas' : 'Arial' };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRANATE_TENUE } };
    });
  }

  res.addRow([]);
  const marginPctRow = res.addRow(['Margen bruto (%)', 0]);
  marginPctRow.getCell(2).value = { formula: `B${marginRow.number}/B${salesRow.number}` };
  marginPctRow.getCell(2).numFmt = '0.0%';

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
