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
      totalDaysPerYear: orUndef(findNumberByLabel(wb, ['Total días por año', 'Días del año'])),
      unpaidAbsence: {
        sundays: orUndef(findNumberByLabel(wb, ['Domingos'])),
        saturdays: orUndef(findNumberByLabel(wb, ['Sábados'])),
        unjustifiedAbsences: orUndef(findNumberByLabel(wb, ['Ausencias injustificadas'])),
        holidaysOnWeekend: orUndef(findNumberByLabel(wb, ['Feriados en fin de semana'])),
      },
      paidAbsence: {
        holidays: orUndef(findNumberByLabel(wb, ['Feriados'])),
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
    departments: departmentRows.map((r) => ({
      name: String(r[0]),
      basicRemuneration: Number(r[1]),
      hoursWorked: Number(r[2]),
    })),
  };
}
