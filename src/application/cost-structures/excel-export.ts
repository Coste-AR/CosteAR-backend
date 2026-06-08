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
  const mp = wb.addWorksheet('1-Materia Prima');
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
  const mod = wb.addWorksheet('2-Mano de Obra');
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
  const cip = wb.addWorksheet('3-Costos Indirectos');
  cip.columns = [{ width: 28 }, { width: 16 }, { width: 16 }];
  titleRow(cip, 'HOJA 3 · Costos Indirectos');
  styleHeader(cip.addRow(['Concepto', 'Fijo', 'Variable']));
  for (const c of ic.concepts) cip.addRow([c.name, c.amount.fixed, c.amount.variable]);

  // --- Resultado (Estado de Costos) ---
  const input: CalculationInput = {
    rawMaterial: rm,
    directLabor: dl,
    indirectCosts: ic,
    inventory: { initialWorkInProcess: 0, finalWorkInProcess: 0, initialFinishedGoods: 0, finalFinishedGoods: 0 },
    sales: { unitPrice: s.salesUnitPrice, quantity: s.salesQuantity },
  };
  const result = runCalculation(input);

  const res = wb.addWorksheet('4-Estado de Costos');
  res.columns = [{ width: 40 }, { width: 20 }];
  titleRow(res, 'HOJA 4 · Estado de Costos');
  const moneyFmt = '"$"#,##0.00';
  const rows: Array<[string, number]> = [
    ['Materia Prima consumida', result.rawMaterialConsumed],
    ['Mano de Obra Directa', result.directLaborTotal],
    ['CIP aplicados', result.indirectCostsApplied],
    ['COSTO DE PRODUCCIÓN', result.productionCost],
    ['COSTO DE PRODUCTOS VENDIDOS', result.costOfGoodsSold],
    ['Margen bruto', result.grossMargin],
  ];
  for (const [label, value] of rows) {
    const row = res.addRow([label, value]);
    row.getCell(2).numFmt = moneyFmt;
    row.getCell(2).font = { name: 'Consolas' };
    if (label.startsWith('COSTO')) {
      row.eachCell((c, colNumber) => {
        c.font = { bold: true, color: { argb: INK }, name: colNumber === 2 ? 'Consolas' : 'Arial' };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRANATE_TENUE } };
      });
    }
  }
  res.addRow([]);
  const marginRow = res.addRow(['Margen bruto (%)', result.grossMarginPct / 100]);
  marginRow.getCell(2).numFmt = '0.0%';

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
