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

  // `id` se usa aguas abajo como clave real (serviceDistributions[].serviceCenterId,
  // productiveSettings[].centerId, y el diccionario de costos por centro en
  // indirect-costs.ts). Dos nombres distintos que normalizan al mismo slug
  // (espacios, mayúsculas, acentos, o directamente el mismo nombre repetido)
  // NO pueden colapsar silenciosamente en un único id — sus costos se
  // mezclarían sin ningún error. Se desambigua determinísticamente dentro de
  // esta misma extracción agregando un sufijo -2, -3, ... al primer choque.
  const seenIds = new Set<string>();
  const centers = centerRows
    .map((r) => {
      const type = mapType(r[1]);
      if (!type) return null;
      const name = String(r[0]);
      return { id: slugify(name), name, type };
    })
    .filter((c): c is { id: string; name: string; type: 'productive' | 'service' } => c !== null)
    .map((c) => {
      let id = c.id;
      let n = 2;
      while (seenIds.has(id)) {
        id = `${c.id}-${n}`;
        n++;
      }
      seenIds.add(id);
      return { ...c, id };
    });

  // `findTableByHeaders` ya devuelve las columnas numéricas parseadas (o el
  // texto original si no pudo interpretarlas como número). Un concepto cuyo
  // fijo o variable no se pudo parsear queda descartado acá en vez de
  // colarse con un 0 inventado: mismo criterio que extract-direct-labor.ts
  // (ambiguo/no-parseable → no se adivina, va a carga manual). Un 0
  // legítimo en la celda origen ya llega como número 0 vía toNumber, así
  // que este filtro no descarta conceptos que realmente cuestan cero.
  const concepts = conceptRows
    .filter((r): r is [unknown, number, number] => typeof r[1] === 'number' && typeof r[2] === 'number')
    .map((r) => ({
      name: String(r[0]),
      amount: { fixed: r[1], variable: r[2] },
      distribution: {},
    }));

  return { centers, concepts };
}
