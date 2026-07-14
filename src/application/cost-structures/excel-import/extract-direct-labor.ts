import type ExcelJS from 'exceljs';
import { findNumberByLabel } from './label-finder.js';
import { findTableByHeaders } from './table-finder.js';

export interface PartialDirectLaborConfig {
  workingDays?: {
    totalDaysPerYear?: number;
    unpaidAbsence?: { sundays?: number; saturdays?: number; unjustifiedAbsences?: number; holidaysOnWeekend?: number };
    paidAbsence?: { holidays?: number; vacations?: number; sickness?: number; specialLeaves?: number; workAccidents?: number };
  };
  itcs?: { derivationBase?: number; fixedArt?: number };
  departments?: Array<{ name: string; basicRemuneration: number; hoursWorked: number }>;
}

function orUndef(n: number | null): number | undefined {
  return n === null ? undefined : n;
}

export function extractDirectLabor(wb: ExcelJS.Workbook): PartialDirectLaborConfig {
  const departmentRows = findTableByHeaders(wb, [
    ['Departamento'],
    ['Remun. básica', 'Remuneración básica'],
    ['Horas-Hombre', 'Horas trabajadas'],
  ]);

  return {
    workingDays: {
      totalDaysPerYear: orUndef(
        findNumberByLabel(wb, ['Total días por año', 'Días del año', 'Días totales del año']),
      ),
      unpaidAbsence: {
        sundays: orUndef(findNumberByLabel(wb, ['Domingos'])),
        saturdays: orUndef(findNumberByLabel(wb, ['Sábados'])),
        unjustifiedAbsences: orUndef(
          findNumberByLabel(wb, ['Ausencias injustificadas', 'Inasistencias injustificadas']),
        ),
        holidaysOnWeekend: orUndef(
          findNumberByLabel(wb, [
            'Feriados en fin de semana',
            'Feriados coincidentes con fin de semana',
          ]),
        ),
      },
      paidAbsence: {
        // OJO: "Feriados" a secas NO está en esta lista a propósito. Si el
        // Excel también tiene una fila de "Feriados en fin de semana" (otro
        // campo), un genérico "Feriados" matchearía las dos filas por igual
        // — no hay forma de saber cuál es cuál con solo esa palabra — así
        // que preferimos exigir un calificador ("nacionales"/"provinciales")
        // antes que arriesgarnos a la ambigüedad con el campo vecino.
        holidays: orUndef(
          findNumberByLabel(wb, ['Feriados nacionales', 'Feriados Nacionales y Provinciales']),
        ),
        vacations: orUndef(findNumberByLabel(wb, ['Vacaciones'])),
        sickness: orUndef(findNumberByLabel(wb, ['Enfermedad'])),
        specialLeaves: orUndef(findNumberByLabel(wb, ['Licencias especiales'])),
        workAccidents: orUndef(findNumberByLabel(wb, ['Accidentes de trabajo'])),
      },
    },
    itcs: {
      derivationBase: orUndef(findNumberByLabel(wb, ['Base de derivación'])),
      fixedArt: orUndef(findNumberByLabel(wb, ['ART fija'])),
    },
    // `findTableByHeaders` ya devuelve las columnas numéricas parseadas (o el
    // texto original si no pudo interpretarlas como número). Una fila cuya
    // remuneración u horas no se pudieron parsear queda descartada acá en vez
    // de colarse como NaN en la config: mismo criterio que el resto del
    // extractor (ambiguo/no-parseable → no se adivina, va a carga manual).
    departments: departmentRows
      .filter((r): r is [unknown, number, number] => typeof r[1] === 'number' && typeof r[2] === 'number')
      .map((r) => ({
        name: String(r[0]),
        basicRemuneration: r[1],
        hoursWorked: r[2],
      })),
  };
}
