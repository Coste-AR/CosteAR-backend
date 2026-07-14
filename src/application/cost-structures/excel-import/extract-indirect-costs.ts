import type ExcelJS from 'exceljs';
import { findTableByHeaders } from './table-finder.js';

export interface PartialIndirectCostConfig {
  centers: Array<{ id: string; name: string; type: 'productive' | 'service' }>;
  concepts: Array<{ name: string; amount: { fixed: number; variable: number }; distribution: Record<string, number> }>;
}

function slugify(name: string): string {
  // NFD separa la letra de su acento (á → a + acento suelto); \p{Diacritic}
  // (Unicode property escape, requiere el flag "u") saca esos acentos sueltos
  // sin tener que pegar un rango de caracteres combinados en el código fuente.
  return name.toLowerCase().trim().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^a-z0-9]+/g, '-');
}

function mapType(raw: unknown): 'productive' | 'service' | null {
  const t = String(raw).toLowerCase().trim();
  if (t.startsWith('productiv')) return 'productive';
  if (t.startsWith('servicio')) return 'service';
  return null;
}

export function extractIndirectCosts(wb: ExcelJS.Workbook): PartialIndirectCostConfig {
  const centerRows = findTableByHeaders(wb, [['Centro', 'Centro de costo'], ['Tipo']]);
  const conceptRows = findTableByHeaders(wb, [['Concepto'], ['Fijo'], ['Variable']]);

  const centers = centerRows
    .map((r) => {
      const type = mapType(r[1]);
      if (!type) return null;
      const name = String(r[0]);
      return { id: slugify(name), name, type };
    })
    .filter((c): c is { id: string; name: string; type: 'productive' | 'service' } => c !== null);

  const concepts = conceptRows.map((r) => {
    // findTableByHeaders already parsed numeric cells via toNumber(), returning either
    // a JS number or null. We DON'T re-call Number() on already-parsed values.
    // For empty/unparseable cells (null or string), default to 0 (reasonable for a cost).
    const fixed = typeof r[1] === 'number' ? r[1] : 0;
    const variable = typeof r[2] === 'number' ? r[2] : 0;

    return {
      name: String(r[0]),
      amount: { fixed, variable },
      distribution: {},
    };
  });

  return { centers, concepts };
}
