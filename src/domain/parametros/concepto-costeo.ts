/**
 * CONCEPTOS DE COSTEO — clasificación por debajo de los tres baldes (M1-01).
 *
 * Qué problema resuelve
 * ---------------------
 * `ParametroCosteo.comportamientoVolumen` clasifica frente al volumen con tres
 * claves fijas: MP, MOD y CIP. Un CIP real mezcla energía (variable) con
 * depreciación (fija); con un solo balde hay que elegir una etiqueta para las
 * dos, y el número que sale es un promedio de cosas que no se comportan igual.
 *
 * `ConceptoCosteo` es el mismo tipo de fila que `ParametroCosteo` — cascada
 * período → estructura → empresa, mismo `confirmado`/`clasificadoPorUserId` —
 * pero con `clave` libre en vez de un catálogo fijo: cada empresa desagrega
 * sus propios conceptos ("energia_planta", "amortizacion_plantel") en vez de
 * clasificar todo el CIP junto.
 *
 * 🔴 Compatibilidad hacia atrás (regla dura del plan): una empresa sin ningún
 * `ConceptoCosteo` sigue resolviendo exactamente como hoy, contra los tres
 * baldes de `ParametroCosteo`. Esta capa NO decide sola cuándo un concepto
 * manda sobre un balde — eso es responsabilidad de quien la llama (hoy,
 * nadie: ver el ADR 0021 sobre por qué esta tarea no conecta todavía los
 * conceptos al motor de cálculo).
 *
 * Esta capa es pura: no toca la base. La persistencia vive en el servicio.
 */

export type CausaVariabilidad =
  | 'volumen'
  | 'tiempo'
  | 'intensidad_de_uso'
  | 'precio'
  | 'contrato'
  | 'otra';

export const CAUSAS_VARIABILIDAD: CausaVariabilidad[] = [
  'volumen',
  'tiempo',
  'intensidad_de_uso',
  'precio',
  'contrato',
  'otra',
];

export type ComportamientoVolumen = 'VARIABLE' | 'FIJO' | 'SEMIFIJO';
export type ElementoConcepto = 'MP' | 'MOD' | 'CIP' | 'VENTA';

/**
 * R4/R8, hechos regla de validación: un concepto VARIABLE cuya causa no es el
 * volumen es una contradicción — R4 dice que la clasificación fijo/variable
 * se define por CAUSALIDAD, no por variabilidad observada, y si la causa
 * declarada no es el volumen no hay causalidad de volumen que justifique
 * "variable". Es la regla que hace estructuralmente imposible repetir el
 * error de la amortización (`AM17`, "el error más caro del proyecto"; mismo
 * criterio que ya aplica `parametros-costeo-service.ts` para
 * `comportamiento_amortizacion_activos`).
 */
export function violaCausalidadDeVolumen(
  comportamientoVolumen: ComportamientoVolumen | null | undefined,
  causaVariabilidad: CausaVariabilidad | null | undefined,
): boolean {
  return comportamientoVolumen === 'VARIABLE' && causaVariabilidad != null && causaVariabilidad !== 'volumen';
}

/** Una fila de `ConceptoCosteo`, reducida a lo que hace falta para resolver. */
export interface FilaConceptoCosteo {
  id: string;
  clave: string;
  descripcion: string | null;
  elemento: ElementoConcepto;
  comportamientoVolumen: ComportamientoVolumen | null;
  causaVariabilidad: CausaVariabilidad | null;
  erogable: boolean | null;
  horizonteErogableMeses: number | null;
  evitable: boolean | null;
  nivelSegmentacion: string | null;
  segmentoId: string | null;
  rangoActividadDesde: number | null;
  rangoActividadHasta: number | null;
  periodId: string | null;
  structureId: string | null;
  confirmado: boolean;
  clasificadoPorUserId: string | null;
  clasificadoEn: Date | null;
}

export type OrigenConcepto = 'periodo' | 'estructura' | 'empresa';

export interface ConceptoCosteoResuelto extends FilaConceptoCosteo {
  origen: OrigenConcepto;
}

/**
 * Cascada período → estructura → empresa, igual que `resolverComportamiento`.
 *
 * A diferencia de `resolverParametro`/`resolverComportamiento`, acá NO hay un
 * catálogo de defaults al final: un concepto lo crea el cliente (o el
 * onboarding), nunca el sistema. Sin ninguna fila para esa clave, devuelve
 * `null` — "no hay concepto cargado para esto", que es distinto de "hay un
 * concepto y no está clasificado".
 */
export function resolverConceptoCosteo(
  clave: string,
  filas: FilaConceptoCosteo[],
  ctx: { periodId?: string | null; structureId?: string | null },
): ConceptoCosteoResuelto | null {
  const delTema = filas.filter((f) => f.clave === clave);
  const buscar = (pred: (f: FilaConceptoCosteo) => boolean, origen: OrigenConcepto) => {
    const fila = delTema.find(pred);
    return fila ? { ...fila, origen } : null;
  };
  return (
    (ctx.periodId ? buscar((f) => f.periodId === ctx.periodId, 'periodo') : null) ??
    (ctx.structureId
      ? buscar((f) => f.periodId === null && f.structureId === ctx.structureId, 'estructura')
      : null) ??
    buscar((f) => f.periodId === null && f.structureId === null, 'empresa')
  );
}

/**
 * Todos los conceptos vigentes de un elemento, ya resueltos por cascada — uno
 * por `clave` distinta. Es lo que necesita cualquier consumidor futuro (el
 * motor de cálculo, una pantalla de desagregación) para saber qué conceptos
 * existen hoy para, por ejemplo, el CIP de una empresa.
 */
export function resolverConceptosDeElemento(
  elemento: ElementoConcepto,
  filas: FilaConceptoCosteo[],
  ctx: { periodId?: string | null; structureId?: string | null },
): ConceptoCosteoResuelto[] {
  const claves = [...new Set(filas.filter((f) => f.elemento === elemento).map((f) => f.clave))];
  return claves
    .map((clave) => resolverConceptoCosteo(clave, filas, ctx))
    .filter((r): r is ConceptoCosteoResuelto => r !== null);
}
