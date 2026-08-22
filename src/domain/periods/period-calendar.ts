/**
 * CALENDARIO DE PERÍODOS (problema C — Fase 1).
 *
 * Traduce el RITMO de costeo de una empresa (mensual / quincenal / trimestral /
 * ciclos de días fijos) a períodos concretos: su código, su nombre y sus fechas
 * límite.
 *
 * Es lógica PURA (no toca la base de datos): dado un código de período, sabe
 * cuál es el siguiente y entre qué fechas vive. El código es siempre ORDENABLE
 * alfabéticamente, para que "el último período" sea simplemente el mayor.
 *
 *   MONTHLY     "2026-07"     → 01/07/2026 a 31/07/2026
 *   BIWEEKLY    "2026-07-Q1"  → 01/07/2026 a 15/07/2026
 *               "2026-07-Q2"  → 16/07/2026 a 31/07/2026
 *   QUARTERLY   "2026-T3"     → 01/07/2026 a 30/09/2026
 *   CUSTOM_DAYS "2026-08-05"  → 05/08/2026 a 14/08/2026 (ciclo de 10 días)
 *
 * SOBRE CUSTOM_DAYS (ciclos de días fijos)
 * ----------------------------------------
 * Los otros tres ritmos se deducen solos de una fecha: julio es julio para todo
 * el mundo. Un ciclo de 10 o 15 días, no: hace falta saber DESDE CUÁNDO se
 * cuenta. Por eso este ritmo no es un string suelto sino un objeto con dos datos
 * más — el largo del ciclo y la fecha ancla desde la que se cuentan —, y los
 * ciclos son contiguos a partir de esa ancla (no se reinician con el mes).
 *
 * El código es la fecha de inicio del ciclo ("2026-08-05"), que sigue siendo
 * ordenable alfabéticamente igual que los demás.
 */

export type Periodicity = 'MONTHLY' | 'BIWEEKLY' | 'QUARTERLY' | 'CUSTOM_DAYS';

/**
 * Ritmo de ciclos de días fijos. `anchorDate` es el día en que arrancó el primer
 * ciclo; todos los demás se cuentan de ahí, hacia adelante y hacia atrás.
 */
export interface CustomDaysRhythm {
  kind: 'CUSTOM_DAYS';
  lengthDays: number;
  anchorDate: Date;
}

/**
 * Lo que aceptan las funciones de este módulo: los tres ritmos de calendario
 * como string (retrocompatible con todo el código que ya existía), o el objeto
 * de ciclos de días fijos.
 */
export type Rhythm = Periodicity | CustomDaysRhythm;

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
const RE_CUSTOM = /^(\d{4})-(\d{2})-(\d{2})$/;

const MS_PER_DAY = 86_400_000;

export class InvalidPeriodCodeError extends Error {
  constructor(code: string, rhythm: Rhythm) {
    const name = typeof rhythm === 'string' ? rhythm : `ciclos de ${rhythm.lengthDays} días`;
    super(`El código de período "${code}" no corresponde al ritmo ${name} de la empresa.`);
    this.name = 'InvalidPeriodCodeError';
  }
}

/**
 * Un ritmo CUSTOM_DAYS necesita largo y ancla. Si alguien lo pasa como el string
 * pelado 'CUSTOM_DAYS' es un bug de configuración, no un código mal tipeado: la
 * estructura quedó marcada como "ciclos de días fijos" sin decir de cuántos días
 * ni desde cuándo. Se avisa distinto para que no se confunda con un período mal
 * escrito por el usuario.
 */
export class IncompleteRhythmError extends Error {
  constructor() {
    super(
      'La estructura está configurada con ciclos de días fijos pero le falta el largo del ' +
        'ciclo o la fecha de inicio. Completá la frecuencia en la configuración de la estructura.',
    );
    this.name = 'IncompleteRhythmError';
  }
}

/**
 * Normaliza lo que llega a un ritmo usable, y valida el ciclo de días fijos.
 * `lengthDays` tiene que ser un entero de 1 a 366: menos de un día no es un
 * período, y más de un año ya es otro ritmo.
 */
function normalizeRhythm(rhythm: Rhythm): Exclude<Periodicity, 'CUSTOM_DAYS'> | CustomDaysRhythm {
  if (rhythm === 'CUSTOM_DAYS') throw new IncompleteRhythmError();
  if (typeof rhythm === 'string') return rhythm;
  if (!Number.isInteger(rhythm.lengthDays) || rhythm.lengthDays < 1 || rhythm.lengthDays > 366) {
    throw new IncompleteRhythmError();
  }
  if (!(rhythm.anchorDate instanceof Date) || Number.isNaN(rhythm.anchorDate.getTime())) {
    throw new IncompleteRhythmError();
  }
  return rhythm;
}

/** Días enteros entre dos fechas UTC (a − b). */
function daysBetween(a: Date, b: Date): number {
  return Math.round((utcMidnight(a).getTime() - utcMidnight(b).getTime()) / MS_PER_DAY);
}

/** Descarta la hora: solo importa el día. */
function utcMidnight(d: Date): Date {
  return utc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** "2026-08-05" a partir de una fecha. */
function isoCode(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Inicio del ciclo que contiene a `date`. Sirve tanto para fechas posteriores al
 * ancla como anteriores (`Math.floor` de un negativo redondea hacia atrás, que
 * es justo lo que queremos: un documento con fecha previa al ancla cae en el
 * ciclo que la contiene, no en el siguiente).
 */
function cycleStartFor(date: Date, rhythm: CustomDaysRhythm): Date {
  const offset = daysBetween(date, rhythm.anchorDate);
  const index = Math.floor(offset / rhythm.lengthDays);
  return addDays(utcMidnight(rhythm.anchorDate), index * rhythm.lengthDays);
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * MS_PER_DAY);
}

/**
 * "5 al 14 de agosto de 2026" — y si el ciclo cruza mes o año, se nombran los
 * dos: "28 de julio al 6 de agosto de 2026", "28 de diciembre de 2026 al 6 de
 * enero de 2027".
 */
function customLabel(start: Date, end: Date): string {
  // `getUTCMonth()` siempre devuelve 0-11, así que el `?? ''` es inalcanzable:
  // está solo para que TS no tenga que confiar en eso.
  const mes = (d: Date) => (MONTHS[d.getUTCMonth()] ?? '').toLowerCase();
  const dia = (d: Date) => d.getUTCDate();

  if (start.getUTCFullYear() !== end.getUTCFullYear()) {
    return `${dia(start)} de ${mes(start)} de ${start.getUTCFullYear()} al ${dia(end)} de ${mes(end)} de ${end.getUTCFullYear()}`;
  }
  if (start.getUTCMonth() !== end.getUTCMonth()) {
    return `${dia(start)} de ${mes(start)} al ${dia(end)} de ${mes(end)} de ${end.getUTCFullYear()}`;
  }
  return `${dia(start)} al ${dia(end)} de ${mes(end)} de ${end.getUTCFullYear()}`;
}

/** Bounds de un ciclo de días fijos, validando que el código caiga justo en un inicio de ciclo. */
function customBounds(code: string, rhythm: CustomDaysRhythm): PeriodBounds {
  const m = RE_CUSTOM.exec(code);
  if (!m) throw new InvalidPeriodCodeError(code, rhythm);

  const start = utc(Number(m[1]), Number(m[2]), Number(m[3]));
  // `new Date(Date.UTC(2026, 12, 40))` no explota, corre la fecha. Comparar el
  // código de vuelta detecta esos casos (mes 13, día 32, 30 de febrero).
  if (isoCode(start) !== code) throw new InvalidPeriodCodeError(code, rhythm);

  // Un día suelto no es un período: tiene que ser el arranque de un ciclo.
  if (daysBetween(start, rhythm.anchorDate) % rhythm.lengthDays !== 0) {
    throw new InvalidPeriodCodeError(code, rhythm);
  }

  const endDate = addDays(start, rhythm.lengthDays - 1);
  return { code, label: customLabel(start, endDate), startDate: start, endDate };
}

/** Datos completos de un período a partir de su código. */
export function periodBounds(code: string, rhythm: Rhythm): PeriodBounds {
  const periodicity = normalizeRhythm(rhythm);
  if (typeof periodicity !== 'string') return customBounds(code, periodicity);

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
export function nextPeriodCode(code: string, rhythm: Rhythm): string {
  const periodicity = normalizeRhythm(rhythm);
  if (typeof periodicity !== 'string') {
    // `customBounds` valida el código antes de moverse: si el ciclo no existe,
    // avisa en vez de devolver un "siguiente" de algo que nunca existió.
    const { startDate } = customBounds(code, periodicity);
    return isoCode(addDays(startDate, periodicity.lengthDays));
  }

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
export function codeFromDate(date: Date, rhythm: Rhythm): string {
  const periodicity = normalizeRhythm(rhythm);
  if (typeof periodicity !== 'string') return isoCode(cycleStartFor(date, periodicity));

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
export function normalizeLegacyCode(code: string, rhythm: Rhythm): string {
  const periodicity = normalizeRhythm(rhythm);
  if (typeof periodicity !== 'string') {
    const m = RE_MONTHLY.exec(code);
    // Ya está en formato de ciclo: se devuelve tal cual (aunque no esté alineado
    // al ancla — normalizar no es validar; de eso se encarga `periodBounds`).
    if (!m) return code;
    // El mes viejo se traduce al ciclo que contiene a su primer día.
    return isoCode(cycleStartFor(utc(Number(m[1]), Number(m[2]), 1), periodicity));
  }

  if (periodicity === 'MONTHLY') return code;
  const m = RE_MONTHLY.exec(code);
  if (!m) return code; // ya está en el formato nuevo
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (periodicity === 'BIWEEKLY') return `${year}-${String(month).padStart(2, '0')}-Q1`;
  return `${year}-T${Math.floor((month - 1) / 3) + 1}`;
}
