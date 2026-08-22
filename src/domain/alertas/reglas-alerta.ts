import { Decimal } from 'decimal.js';

/**
 * REGLAS DE ALERTA POR INDICADOR FÍSICO — S-05b.
 *
 * Qué problema resuelve
 * ---------------------
 * El detector de anomalías (`application/alerts/anomaly-detection.ts`) compara
 * **costos** contra su propia historia. Eso avisa cuando el costo ya se movió.
 *
 * En una explotación, la señal temprana es **física**: la humedad de un grano al
 * ingreso, el porcentaje de producción, los días que la materia prima lleva
 * almacenada, el peso de los animales contra la tabla de la raza. Cuando esos se
 * salen de rango el costo **todavía no se movió — pero se va a mover**.
 *
 * Dos reglas duras
 * ----------------
 * 1. **Ningún umbral se escribe en el código.** El que sabe cuál es el umbral es
 *    el productor. Un umbral hardcodeado es un umbral que nadie puede corregir.
 * 2. **Ninguna alerta modifica un costo.** Avisa; qué hacer lo decide una persona.
 *
 * Esta capa es pura: no toca la base ni manda nada. Devuelve hallazgos.
 */

export type CondicionAlerta = 'MAYOR' | 'MENOR' | 'FUERA_DE_RANGO_PCT';
export type SeveridadAlerta = 'INFO' | 'ADVERTENCIA' | 'CRITICA';

export interface ReglaAlerta {
  id: string;
  /** Qué se mide: "humedad_maiz_ingreso", "postura_plantel". */
  indicador: string;
  descripcion: string;
  condicion: CondicionAlerta;
  umbral: number;
  /** Unidad del umbral, para poder escribir el mensaje. Ej: "%", "días". */
  unidad?: string | null;
  /**
   * Cuántas lecturas consecutivas tienen que cumplir la condición antes de
   * disparar. 1 = al instante.
   *
   * No es lo mismo una caída puntual que una sostenida: una postura baja un día
   * puede ser el termómetro; tres días seguidos es un problema. Alertar por la
   * primera hace que se terminen ignorando todas.
   */
  lecturasSostenidas: number;
  severidad: SeveridadAlerta;
  activa: boolean;
}

export interface Lectura {
  /** Cuándo se midió. Se usa para ordenar, no para decidir. */
  fecha: Date;
  valor: number;
  /**
   * Valor de referencia contra el que comparar, solo para `FUERA_DE_RANGO_PCT`.
   * Ej: el peso que la tabla de la raza dice para esa semana.
   */
  referencia?: number | null;
}

export interface HallazgoAlerta {
  reglaId: string;
  indicador: string;
  severidad: SeveridadAlerta;
  /** El valor que disparó la alerta. */
  valor: number;
  umbral: number;
  /** Cuántas lecturas consecutivas venían cumpliendo la condición. */
  lecturasEnCondicion: number;
  /** En castellano, para el productor. Sin nombres de campo ni ids. */
  mensaje: string;
  /** El respaldo del número: sin esto la alerta es una afirmación sin evidencia. */
  explicacion: string[];
}

/** Formato determinístico: `toLocaleString` depende del ICU del runtime. */
function num(v: number, decimales = 2): string {
  const s = new Decimal(v).toFixed(decimales);
  const [entera, dec] = s.split('.');
  const conMiles = entera!.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return dec && Number(dec) !== 0 ? `${conMiles},${dec.replace(/0+$/, '')}` : conMiles;
}

function unidadDe(regla: ReglaAlerta): string {
  return regla.unidad ? ` ${regla.unidad}` : '';
}

/** ¿Esta lectura sola cumple la condición de la regla? */
export function cumpleCondicion(regla: ReglaAlerta, lectura: Lectura): boolean {
  const valor = new Decimal(lectura.valor);
  const umbral = new Decimal(regla.umbral);

  switch (regla.condicion) {
    case 'MAYOR':
      return valor.greaterThan(umbral);
    case 'MENOR':
      return valor.lessThan(umbral);
    case 'FUERA_DE_RANGO_PCT': {
      // Sin referencia no se puede evaluar: NO se asume que está bien.
      if (lectura.referencia === null || lectura.referencia === undefined) return false;
      const ref = new Decimal(lectura.referencia);
      if (ref.isZero()) return false;
      const desvioPct = valor.minus(ref).dividedBy(ref).abs().times(100);
      return desvioPct.greaterThan(umbral);
    }
  }
}

/**
 * Evalúa una regla contra sus lecturas, de la más NUEVA a la más vieja.
 *
 * Devuelve `null` cuando no hay que decir nada — que es la mayoría de las veces,
 * y está bien: una pantalla que alerta siempre es una pantalla que nadie mira.
 */
export function evaluarRegla(regla: ReglaAlerta, lecturas: Lectura[]): HallazgoAlerta | null {
  if (!regla.activa) return null;
  if (lecturas.length === 0) return null;

  const ordenadas = [...lecturas].sort((a, b) => b.fecha.getTime() - a.fecha.getTime());

  // Se cuenta desde la más nueva hacia atrás: la racha tiene que llegar hasta hoy.
  // Una racha que terminó hace una semana ya no es un problema abierto.
  let consecutivas = 0;
  for (const l of ordenadas) {
    if (!cumpleCondicion(regla, l)) break;
    consecutivas++;
  }

  if (consecutivas < regla.lecturasSostenidas) return null;

  const ultima = ordenadas[0]!;
  const u = unidadDe(regla);

  let mensaje: string;
  const explicacion: string[] = [];

  switch (regla.condicion) {
    case 'MAYOR':
      mensaje = `${regla.descripcion}: ${num(ultima.valor)}${u}, por encima del límite de ${num(regla.umbral)}${u}.`;
      explicacion.push(`Límite configurado: ${num(regla.umbral)}${u}.`);
      break;
    case 'MENOR':
      mensaje = `${regla.descripcion}: ${num(ultima.valor)}${u}, por debajo del mínimo de ${num(regla.umbral)}${u}.`;
      explicacion.push(`Mínimo configurado: ${num(regla.umbral)}${u}.`);
      break;
    case 'FUERA_DE_RANGO_PCT': {
      const ref = new Decimal(ultima.referencia!);
      const desvio = new Decimal(ultima.valor).minus(ref).dividedBy(ref).times(100);
      const sentido = desvio.isPositive() ? 'por encima' : 'por debajo';
      mensaje =
        `${regla.descripcion}: ${num(ultima.valor)}${u} contra ${num(ultima.referencia!)}${u} de referencia, ` +
        `${num(desvio.abs().toNumber(), 1)} % ${sentido} de lo esperado (tolerancia ±${num(regla.umbral, 1)} %).`;
      explicacion.push(`Referencia para esta medición: ${num(ultima.referencia!)}${u}.`);
      explicacion.push(`Tolerancia configurada: ±${num(regla.umbral, 1)} %.`);
      break;
    }
  }

  if (regla.lecturasSostenidas > 1) {
    explicacion.push(
      `Se venía cumpliendo en ${consecutivas} lectura(s) seguidas; ` +
        `la regla pide ${regla.lecturasSostenidas} para avisar.`,
    );
  }

  // Lo mismo que hace el detector de anomalías: la alerta avisa, no decide.
  explicacion.push('Esta alerta no modifica ningún costo: requiere que una persona la evalúe.');

  return {
    reglaId: regla.id,
    indicador: regla.indicador,
    severidad: regla.severidad,
    valor: ultima.valor,
    umbral: regla.umbral,
    lecturasEnCondicion: consecutivas,
    mensaje,
    explicacion,
  };
}

/** Evalúa varias reglas de una. Devuelve solo lo que hay que decir. */
export function evaluarReglas(
  reglas: ReglaAlerta[],
  lecturasPorIndicador: Record<string, Lectura[]>,
): HallazgoAlerta[] {
  const hallazgos: HallazgoAlerta[] = [];
  for (const regla of reglas) {
    const lecturas = lecturasPorIndicador[regla.indicador] ?? [];
    const h = evaluarRegla(regla, lecturas);
    if (h) hallazgos.push(h);
  }
  // Lo más grave arriba: si son quince, las tres primeras son las que se leen.
  const orden: Record<SeveridadAlerta, number> = { CRITICA: 0, ADVERTENCIA: 1, INFO: 2 };
  return hallazgos.sort((a, b) => orden[a.severidad] - orden[b.severidad]);
}

// ---------------------------------------------------------------------------
// Reglas del vertical avícola
// ---------------------------------------------------------------------------

/**
 * Las cuatro que el productor declaró él mismo.
 *
 * Son SEMILLA, no verdad: se cargan como reglas editables y él las ajusta. Los
 * valores salen del relevamiento y ninguno está confirmado.
 *
 * ⚠️ El corpus del clasificador está calibrado para una explotación mucho más
 * grande que la del piloto. Revisar estos umbrales antes de activarlos, o van a
 * disparar todo el tiempo.
 */
export const REGLAS_AVICOLA_SEMILLA: Omit<ReglaAlerta, 'id' | 'activa'>[] = [
  {
    indicador: 'humedad_grano_ingreso',
    descripcion: 'Humedad del grano al ingreso',
    condicion: 'MAYOR',
    umbral: 16,
    unidad: '%',
    lecturasSostenidas: 1,
    severidad: 'CRITICA',
  },
  {
    indicador: 'postura_plantel',
    descripcion: 'Porcentaje de postura del plantel',
    condicion: 'MENOR',
    umbral: 85,
    unidad: '%',
    // Sostenida: una caída de un día puede ser el calor. Tres seguidos, no.
    lecturasSostenidas: 3,
    severidad: 'ADVERTENCIA',
  },
  {
    indicador: 'peso_muestreo',
    descripcion: 'Peso por muestreo contra la tabla de la raza',
    condicion: 'FUERA_DE_RANGO_PCT',
    umbral: 10,
    unidad: 'g',
    lecturasSostenidas: 1,
    severidad: 'ADVERTENCIA',
  },
  {
    indicador: 'dias_estiba',
    descripcion: 'Días que el alimento lleva almacenado',
    condicion: 'MAYOR',
    umbral: 14,
    unidad: 'días',
    lecturasSostenidas: 1,
    severidad: 'ADVERTENCIA',
  },
];
