/**
 * PARÁMETROS DE COSTEO — catálogo de defaults y resolución en cascada.
 *
 * Qué problema resuelve
 * ---------------------
 * El vertical avícola necesita constantes de negocio que hasta ahora no tenían
 * dónde vivir: cuántos huevos entran en un cajón, cuántos meses dura el lote de
 * gallinas, a partir de qué porcentaje una merma deja de ser normal.
 *
 * Sin este catálogo, cada una de esas constantes termina hardcodeada en el
 * código. **Un número de negocio hardcodeado es un número que nadie puede
 * corregir sin un PR, y que nadie sabe que está ahí hasta que da mal.**
 *
 * Todo default de acá es EDITABLE y, sobre todo, es rastreable: el resultado dice
 * si el valor que usó era un default del sistema o algo que el cliente confirmó.
 *
 * Esta capa es pura: no toca la base. La persistencia vive en el servicio.
 */

export type OrigenParametro = 'periodo' | 'estructura' | 'empresa' | 'default';

export interface DefinicionParametro {
  clave: string;
  descripcion: string;
  valorDefault: number;
  /** Código de `UnidadMedida`, cuando el valor está expresado en alguna. */
  unidad?: string;
  /**
   * `true` cuando el default es una convención segura (un cajón son 360 huevos
   * siempre). `false` cuando es una estimación que hay que confirmar con el
   * cliente antes de tomarla por cierta.
   */
  seguro: boolean;
  /** Por qué ese default y qué hay que preguntar si `seguro` es `false`. */
  nota?: string;
}

/**
 * Catálogo del vertical avícola.
 *
 * Los marcados `seguro: false` son los datos abiertos del plan: se usan para que
 * el sistema pueda calcular, pero el resultado los señala como sin confirmar.
 */
export const PARAMETROS_AVICOLA: DefinicionParametro[] = [
  {
    clave: 'huevos_por_cajon',
    descripcion: 'Huevos que entran en un cajón. Es la unidad de gestión del negocio.',
    valorDefault: 360,
    unidad: 'huevo',
    seguro: true,
  },
  {
    clave: 'huevos_por_maple',
    descripcion: 'Huevos que entran en un maple.',
    valorDefault: 30,
    unidad: 'huevo',
    seguro: true,
  },
  {
    clave: 'maples_por_cajon',
    descripcion: 'Maples que entran en un cajón. Se deriva: 360 / 30.',
    valorDefault: 12,
    unidad: 'maple',
    seguro: true,
  },
  {
    clave: 'costo_maple',
    descripcion: 'Costo del maple, que es material de empaque y va al costo variable.',
    valorDefault: 0,
    seguro: false,
    nota: 'Sin dato. Mientras esté en 0, el costo variable por cajón queda subestimado.',
  },
  {
    clave: 'gramaje_estandar_gr',
    descripcion: 'Gramos de alimento por ave por día.',
    valorDefault: 120,
    seguro: false,
    nota: 'Del relevamiento inicial. Varía por raza, edad y clima: confirmar con el cliente.',
  },
  {
    clave: 'vida_util_lote_meses',
    descripcion: 'Meses de vida productiva del lote de ponedoras. Amortiza el plantel.',
    valorDefault: 24,
    seguro: false,
    nota:
      'CONFLICTO ABIERTO (D-01): una fuente dice ~18 meses de vida productiva, ' +
      'otra habla de un ciclo de ~2 años. 24 es el default del plan, no una decisión.',
  },
  {
    clave: 'umbral_merma_normal_pct',
    descripcion:
      'Hasta qué porcentaje una merma se considera normal y la absorben las unidades buenas. ' +
      'Por encima, es extraordinaria y va a resultado del período.',
    valorDefault: 0,
    seguro: false,
    nota:
      'Sin umbral declarado no se puede decidir sola: el sistema manda la merma a revisión ' +
      'humana en vez de elegir por el costista.',
  },
];

const CATALOGO = new Map(PARAMETROS_AVICOLA.map((p) => [p.clave, p]));

export function definicionDe(clave: string): DefinicionParametro | undefined {
  return CATALOGO.get(clave);
}

export interface ValorResuelto {
  clave: string;
  valor: number;
  origen: OrigenParametro;
  /**
   * `false` cuando el valor salió de un default que nadie confirmó. Quien calcula
   * con esto tiene que poder decirlo: un default no confirmado no es un dato.
   */
  confirmado: boolean;
  nota?: string;
}

/** Una fila de `ParametroCosteo`, reducida a lo que hace falta para resolver. */
export interface FilaParametro {
  clave: string;
  valorNum: number | null;
  periodId: string | null;
  structureId: string | null;
  confirmado: boolean;
}

/**
 * Resuelve un parámetro con la regla del más específico gana:
 *
 *     período → estructura → empresa → default del catálogo
 *
 * Devolver el `origen` no es un detalle: es lo que permite que la pantalla
 * distinga "esto lo cargó el cliente" de "esto lo puso el sistema porque no
 * había nada".
 */
export function resolverParametro(
  clave: string,
  filas: FilaParametro[],
  ctx: { periodId?: string | null; structureId?: string | null },
): ValorResuelto {
  const delTema = filas.filter((f) => f.clave === clave && f.valorNum !== null);

  const buscar = (pred: (f: FilaParametro) => boolean, origen: OrigenParametro) => {
    const f = delTema.find(pred);
    return f ? { clave, valor: Number(f.valorNum), origen, confirmado: f.confirmado } : null;
  };

  const encontrado =
    (ctx.periodId ? buscar((f) => f.periodId === ctx.periodId, 'periodo') : null) ??
    (ctx.structureId
      ? buscar((f) => f.periodId === null && f.structureId === ctx.structureId, 'estructura')
      : null) ??
    buscar((f) => f.periodId === null && f.structureId === null, 'empresa');

  if (encontrado) return encontrado;

  const def = CATALOGO.get(clave);
  if (!def) {
    throw new Error(
      `No existe el parámetro de costeo "${clave}" ni cargado ni en el catálogo de defaults.`,
    );
  }

  return {
    clave,
    valor: def.valorDefault,
    origen: 'default',
    // Un default del catálogo nunca se da por confirmado, ni siquiera los seguros:
    // "confirmado" significa que lo dijo el cliente, no que sea razonable.
    confirmado: false,
    nota: def.nota,
  };
}
