/**
 * CALENDARIO DE PERÍODOS (problema C — Fase 1).
 *
 * Traduce el RITMO de costeo de una empresa (mensual / quincenal / trimestral)
 * a períodos concretos: su código, su nombre y sus fechas límite.
 *
 * Es lógica PURA (no toca la base de datos): dado un código de período, sabe
 * cuál es el siguiente y entre qué fechas vive. El código es siempre ORDENABLE
 * alfabéticamente, para que "el último período" sea simplemente el mayor.
 *
 *   MONTHLY    "2026-07"     → 01/07/2026 a 31/07/2026
 *   BIWEEKLY   "2026-07-Q1"  → 01/07/2026 a 15/07/2026
 *              "2026-07-Q2"  → 16/07/2026 a 31/07/2026
 *   QUARTERLY  "2026-T3"     → 01/07/2026 a 30/09/2026
 */

export type Periodicity = 'MONTHLY' | 'BIWEEKLY' | 'QUARTERLY';

export interface PeriodBounds {
  code: string;
  label: string;
  startDate: Date;
  endDate: Date;
}

const MONTHS = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

/** Fecha UTC pura (sin hora): evita que el huso horario corra un día. */
function utc(year: number, month1: number, day: number): Date {
  return new Date(Date.UTC(year, month1 - 1, day));
}

/** Último día del mes (28/29/30/31 según corresponda). */
function lastDayOfMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

const RE_MONTHLY = /^(\d{4})-(\d{2})$/;
const RE_BIWEEKLY = /^(\d{4})-(\d{2})-Q([12])$/;
const RE_QUARTERLY = /^(\d{4})-T([1-4])$/;

export class InvalidPeriodCodeError extends Error {
  constructor(code: string, periodicity: Periodicity) {
    super(`El código de período "${code}" no corresponde al ritmo ${periodicity} de la empresa.`);
    this.name = 'InvalidPeriodCodeError';
  }
}

/** Datos completos de un período a partir de su código. */
export function periodBounds(code: string, periodicity: Periodicity): PeriodBounds {
  if (periodicity === 'MONTHLY') {
    const m = RE_MONTHLY.exec(code);
    if (!m) throw new InvalidPeriodCodeError(code, periodicity);
    const year = Number(m[1]);
    const month = Number(m[2]);
    if (month < 1 || month > 12) throw new InvalidPeriodCodeError(code, periodicity);
    return {
      code,
      label: `${MONTHS[month - 1]} ${year}`,
      startDate: utc(year, month, 1),
      endDate: utc(year, month, lastDayOfMonth(year, month)),
    };
  }

  if (periodicity === 'BIWEEKLY') {
    const m = RE_BIWEEKLY.exec(code);
    if (!m) throw new InvalidPeriodCodeError(code, periodicity);
    const year = Number(m[1]);
    const month = Number(m[2]);
    const half = Number(m[3]);
    if (month < 1 || month > 12) throw new InvalidPeriodCodeError(code, periodicity);
    const first = half === 1;
    return {
      code,
      label: `${first ? '1ª' : '2ª'} quincena de ${MONTHS[month - 1]} ${year}`,
      startDate: utc(year, month, first ? 1 : 16),
      endDate: utc(year, month, first ? 15 : lastDayOfMonth(year, month)),
    };
  }

  const m = RE_QUARTERLY.exec(code);
  if (!m) throw new InvalidPeriodCodeError(code, periodicity);
  const year = Number(m[1]);
  const quarter = Number(m[2]);
  const startMonth = (quarter - 1) * 3 + 1;
  const endMonth = startMonth + 2;
  return {
    code,
    label: `${quarter}º trimestre ${year}`,
    startDate: utc(year, startMonth, 1),
    endDate: utc(year, endMonth, lastDayOfMonth(year, endMonth)),
  };
}

/** El período que sigue al dado. */
export function nextPeriodCode(code: string, periodicity: Periodicity): string {
  if (periodicity === 'MONTHLY') {
    const m = RE_MONTHLY.exec(code);
    if (!m) throw new InvalidPeriodCodeError(code, periodicity);
    let year = Number(m[1]);
    let month = Number(m[2]) + 1;
    if (month > 12) { month = 1; year += 1; }
    return `${year}-${String(month).padStart(2, '0')}`;
  }

  if (periodicity === 'BIWEEKLY') {
    const m = RE_BIWEEKLY.exec(code);
    if (!m) throw new InvalidPeriodCodeError(code, periodicity);
    let year = Number(m[1]);
    let month = Number(m[2]);
    const half = Number(m[3]);
    if (half === 1) return `${year}-${String(month).padStart(2, '0')}-Q2`;
    month += 1;
    if (month > 12) { month = 1; year += 1; }
    return `${year}-${String(month).padStart(2, '0')}-Q1`;
  }

  const m = RE_QUARTERLY.exec(code);
  if (!m) throw new InvalidPeriodCodeError(code, periodicity);
  let year = Number(m[1]);
  let quarter = Number(m[2]) + 1;
  if (quarter > 4) { quarter = 1; year += 1; }
  return `${year}-T${quarter}`;
}

/** A qué período pertenece una fecha (para imputar documentos automáticamente). */
export function codeFromDate(date: Date, periodicity: Periodicity): string {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  const mm = String(month).padStart(2, '0');

  if (periodicity === 'MONTHLY') return `${year}-${mm}`;
  if (periodicity === 'BIWEEKLY') return `${year}-${mm}-Q${day <= 15 ? 1 : 2}`;
  return `${year}-T${Math.floor((month - 1) / 3) + 1}`;
}

/**
 * Convierte un código viejo ("2026-07", el único formato que existía) al ritmo
 * de la empresa. Sirve para abrir el siguiente período de una estructura que
 * viene del modelo anterior.
 */
export function normalizeLegacyCode(code: string, periodicity: Periodicity): string {
  if (periodicity === 'MONTHLY') return code;
  const m = RE_MONTHLY.exec(code);
  if (!m) return code; // ya está en el formato nuevo
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (periodicity === 'BIWEEKLY') return `${year}-${String(month).padStart(2, '0')}-Q1`;
  return `${year}-T${Math.floor((month - 1) / 3) + 1}`;
}
