import { Decimal } from 'decimal.js';
import { ProcessValidationError } from '../errors/calculation-errors.js';

/**
 * COSTEO POR PROCESOS · CUADRO DE MOVIMIENTO DE UNIDADES
 *
 * Resuelve el "cuadro de movimiento de unidades" de UN departamento para UN
 * período: el primer paso, fundacional, del Costeo por Procesos. Todo lo que
 * viene después (producción equivalente, informe de costos) depende de que
 * este cuadro cuadre.
 *
 * El cuadro tiene dos lados que SIEMPRE deben balancear:
 *   unidades A JUSTIFICAR (entradas)  =  unidades JUSTIFICADAS (salidas).
 *
 * ENTRADAS (unidades que entran):
 *   - Existencia inicial de producción en proceso (EI, del período anterior).
 *   - Puestas en elaboración   → solo el departamento inicial (sequence = 1).
 *   - Recibidas del anterior    → solo sequence > 1.
 *   - Aumento de nº de unidades → solo sequence > 1 (aumento físico-químico,
 *     p. ej. agregado de agua).
 *
 * SALIDAS (unidades que salen):
 *   - Terminadas y transferidas (al depto. siguiente, o a productos terminados
 *     si es el último).
 *   - Terminadas en existencia (stock, no transferidas).
 *   - Pérdidas normales.
 *   - Pérdidas extraordinarias.
 *   - Existencia final de producción en proceso (EF).
 *
 * Función PURA: sin Prisma, sin HTTP, sin servicios. Los nombres de campo
 * replican los de la tabla `UnitMovementSchedule` (B04) para que el motor de
 * Procesos (B17) mapee de la fila persistida a esta función sin traducir.
 *
 * Metodología de la Cátedra de Costos (UNT). Caso ancla: Azur Alcoholes,
 * departamento Destilado, abril. Ver DECISIONES.md (B06).
 */

/**
 * Insumos del cuadro para un (departamento, período). Todas las cantidades en
 * unidades. Los campos opcionales que el usuario no conoce se DERIVAN por
 * diferencia (R1): típicamente `transferredOut` o `finalWip`.
 */
export interface UnitMovementInput {
  /** Posición del departamento en la cadena. 1 = departamento inicial. */
  sequence: number;

  // --- ENTRADAS ---
  /** Existencia inicial de producción en proceso (EI). Default 0. */
  initialWip?: Decimal.Value;
  /** Puestas en elaboración — solo sequence = 1. */
  startedInProduction?: Decimal.Value;
  /** Recibidas del departamento anterior — solo sequence > 1. */
  receivedFromPrevious?: Decimal.Value;
  /** Aumento de número de unidades — solo sequence > 1. */
  unitIncrease?: Decimal.Value;

  // --- SALIDAS ---
  /** Terminadas y transferidas. Derivable por diferencia (R1). */
  transferredOut?: Decimal.Value;
  /** Terminadas en existencia (stock). Default 0. */
  finishedInStock?: Decimal.Value;
  /**
   * % de pérdida normal admitido, expresado como FRACCIÓN (0.02 = 2 %).
   * Se aplica sobre las "unidades del período", nunca sobre la EI (R2).
   * Default 0.
   */
  normalLossPct?: Decimal.Value;
  /**
   * Pérdida real total del período (unidades). La pérdida extraordinaria se
   * deriva de acá (R3): extraordinaria = total real − normal. Default = normal
   * (es decir, sin pérdida extraordinaria) si no se informa.
   */
  totalLossReported?: Decimal.Value;
  /** Existencia final de producción en proceso (EF). Derivable por diferencia (R1). */
  finalWip?: Decimal.Value;
}

/**
 * Cuadro resuelto. Trae todas las líneas de entrada y salida ya resueltas
 * (incluida la derivada por diferencia), las "unidades del período" usadas
 * como base de la pérdida normal, ambas pérdidas y los dos totales, para que
 * el llamador muestre el cuadro y verifique el "cuadra / no cuadra".
 */
export interface UnitMovementSchedule {
  // --- ENTRADAS ---
  initialWip: Decimal;
  startedInProduction: Decimal;
  receivedFromPrevious: Decimal;
  unitIncrease: Decimal;

  /** Base de la pérdida normal (R2). No incluye la EI. */
  periodUnits: Decimal;

  // --- SALIDAS ---
  transferredOut: Decimal;
  finishedInStock: Decimal;
  normalLoss: Decimal;
  extraordinaryLoss: Decimal;
  finalWip: Decimal;

  /** Σ unidades a justificar (entradas). */
  totalToAccount: Decimal;
  /** Σ unidades justificadas (salidas). */
  totalAccounted: Decimal;
}

/** `undefined`/`null` → sin dato; en otro caso, a Decimal. */
function opt(value: Decimal.Value | undefined | null): Decimal | undefined {
  return value === undefined || value === null ? undefined : new Decimal(value);
}

/** Igual que `opt`, pero con default cuando no hay dato. */
function withDefault(value: Decimal.Value | undefined | null, fallback: number): Decimal {
  return opt(value) ?? new Decimal(fallback);
}

/* ========================================================================== *
 * COSTEO POR PROCESOS · PÉRDIDAS NORMALES Y EXTRAORDINARIAS (B08)
 * ========================================================================== */

/**
 * Insumos para determinar las pérdidas de un departamento en un período. La
 * base de la pérdida normal —las "unidades del período"— DIFIERE según la
 * posición del departamento en la cadena (R1), así que necesitamos la secuencia
 * y los drivers de cada posición. La pérdida extraordinaria NO se ingresa: se
 * deriva (R2), por eso solo pedimos el % normal y la pérdida real total.
 */
export interface NormalAndExtraordinaryLossInput {
  /** Posición del departamento en la cadena. 1 = departamento inicial. */
  sequence: number;
  /** Puestas en elaboración — base del período en el depto. inicial (seq 1). */
  startedInProduction?: Decimal.Value;
  /** Recibidas del departamento anterior — parte de la base en seq > 1. */
  receivedFromPrevious?: Decimal.Value;
  /** Aumento de número de unidades — parte de la base en seq > 1. */
  unitIncrease?: Decimal.Value;
  /** % de pérdida normal admitido, como FRACCIÓN (0.02 = 2 %). Default 0. */
  normalLossPct?: Decimal.Value;
  /**
   * Pérdida real total informada del período (unidades). La extraordinaria sale
   * de acá por diferencia (R2). Sin dato ⇒ default = pérdida normal (es decir,
   * sin pérdida extraordinaria).
   */
  totalLossReported?: Decimal.Value;
}

/**
 * Pérdidas resueltas de un departamento para un período, más las banderas de
 * TRATAMIENTO (R3) que los pasos siguientes aplican. Esta función computa las
 * CANTIDADES; la valuación ocurre después: B09 reasigna la pérdida normal de los
 * departamentos posteriores (CAUP/CAUO), y la extraordinaria se valúa al Estado
 * de Resultados (no al costo del producto).
 */
export interface NormalAndExtraordinaryLoss {
  /** Base de la pérdida normal (R1). NUNCA incluye la existencia inicial. */
  periodUnits: Decimal;
  /** Pérdida normal = % normal × unidades del período. */
  normalLoss: Decimal;
  /** Pérdida extraordinaria = pérdida real total − pérdida normal (R2). */
  extraordinaryLoss: Decimal;
  /** Pérdida real total del período (normal + extraordinaria). */
  totalLoss: Decimal;
  /**
   * R3 · La pérdida normal la absorben las unidades buenas SIN cálculo adicional
   * porque es el departamento inicial (seq 1). Cuando es `false`, la absorción
   * se instrumenta recalculando el costo unitario (CAUP/CAUO) en B09.
   */
  normalLossAbsorbedAutomatically: boolean;
  /**
   * R3 · La pérdida normal de un departamento posterior (seq > 1) genera el
   * CAUP/CAUO en B09. Complementario de `normalLossAbsorbedAutomatically`.
   */
  normalLossGeneratesCaup: boolean;
}

/**
 * PÉRDIDAS NORMALES Y EXTRAORDINARIAS de un departamento para un período (B08).
 *
 * Fuente ÚNICA de la regla de pérdidas en Costeo por Procesos: `buildUnitMovementSchedule`
 * (B06) delega acá, y el informe (B10) y el CAUP/CAUO (B09) consumen esta salida,
 * para que la regla no viva —ni diverja— en dos lugares.
 *
 * Reglas (source of truth: cátedra; ver DECISIONES.md B08):
 *  - R1: pérdida normal = % normal × "unidades del período", cuya base DIFIERE
 *        por la posición del departamento:
 *          · Departamento inicial (seq 1): base = puestas en elaboración.
 *          · Departamento posterior (seq > 1): base = recibidas del anterior +
 *            aumento de número de unidades.
 *        NUNCA se computa el % sobre la existencia inicial (son unidades del
 *        período anterior). Regla explícita y muy tomada de la cátedra.
 *  - R2: pérdida extraordinaria = pérdida real total informada − pérdida normal
 *        (POR DIFERENCIA). Nunca se ingresa directa. Si la real < normal ⇒
 *        ProcessValidationError (una extraordinaria negativa es imposible).
 *  - R3: tratamiento (banderas de salida). La normal la absorben las unidades
 *        buenas: en el depto. inicial, automáticamente; en los posteriores, vía
 *        CAUP/CAUO (B09). La extraordinaria va al 100 % a la producción
 *        equivalente (B07) y se valúa al Estado de Resultados, no al costo.
 *
 * Función PURA: sin Prisma, sin HTTP, sin servicios. Lanza `ProcessValidationError`
 * (422) — nunca un 500 crudo.
 *
 * Casos ancla (Azur Alcoholes, abril):
 *  - Destilado (seq 1): puestas 30.000, % 2 % → normal 600; real 1.600 → extra 1.000.
 *  - Purificado (seq 2): recibidas 30.000 + aumento 2.000, % 1 % → normal 320.
 */
export function calcNormalAndExtraordinaryLosses(
  input: NormalAndExtraordinaryLossInput,
): NormalAndExtraordinaryLoss {
  const isFirstDepartment = input.sequence === 1;

  // --- R1: unidades del período (base de la pérdida normal). NUNCA la EI. ---
  // El % se aplica sobre las puestas en elaboración (depto. inicial) o sobre las
  // recibidas + aumento (depto. posterior), jamás sobre la existencia inicial.
  const periodUnits = isFirstDepartment
    ? withDefault(input.startedInProduction, 0)
    : withDefault(input.receivedFromPrevious, 0).plus(withDefault(input.unitIncrease, 0));

  // --- Pérdida normal = % normal × unidades del período ---
  const normalLossPct = withDefault(input.normalLossPct, 0);
  const normalLoss = normalLossPct.times(periodUnits);

  // --- R2: pérdida extraordinaria = pérdida real total − pérdida normal ---
  // Nunca se ingresa directa. Sin total informado ⇒ no hay extraordinaria.
  const totalLoss = opt(input.totalLossReported) ?? normalLoss;
  const extraordinaryLoss = totalLoss.minus(normalLoss);
  if (extraordinaryLoss.isNegative()) {
    throw new ProcessValidationError(
      `La pérdida real total (${totalLoss.toString()}) es menor que la pérdida normal (${normalLoss.toString()}); ` +
        'la pérdida extraordinaria no puede ser negativa. Revisá el % de pérdida normal o la pérdida total informada.',
      { field: 'totalLossReported', normalLoss: normalLoss.toNumber(), extraordinaryLoss: extraordinaryLoss.toNumber() },
    );
  }

  return {
    periodUnits,
    normalLoss,
    extraordinaryLoss,
    totalLoss,
    // R3 · tratamiento de la pérdida normal según la posición del departamento.
    normalLossAbsorbedAutomatically: isFirstDepartment,
    normalLossGeneratesCaup: !isFirstDepartment,
  };
}

/**
 * Resuelve el cuadro de movimiento de unidades de un departamento para un
 * período. Ver reglas R1-R5 en el cuerpo. Lanza `ProcessValidationError`
 * (422) ante cualquier configuración imposible o cuadro que no cuadra.
 */
export function buildUnitMovementSchedule(input: UnitMovementInput): UnitMovementSchedule {
  const isFirstDepartment = input.sequence === 1;

  // --- R4: coherencia de las entradas según la posición del departamento ---
  // El departamento inicial NO recibe del anterior ni tiene aumento de
  // unidades: son insumos que físicamente no le corresponden.
  const received = opt(input.receivedFromPrevious);
  const increase = opt(input.unitIncrease);
  const started = opt(input.startedInProduction);

  if (isFirstDepartment) {
    if (received && !received.isZero()) {
      throw new ProcessValidationError(
        'El departamento inicial (secuencia 1) no puede tener unidades recibidas del departamento anterior.',
        { field: 'receivedFromPrevious' },
      );
    }
    if (increase && !increase.isZero()) {
      throw new ProcessValidationError(
        'El departamento inicial (secuencia 1) no puede tener aumento de número de unidades.',
        { field: 'unitIncrease' },
      );
    }
  } else if (started && !started.isZero()) {
    // Simétrico: "puestas en elaboración" solo existen en el departamento inicial.
    throw new ProcessValidationError(
      'Solo el departamento inicial (secuencia 1) puede tener puestas en elaboración; un departamento posterior recibe del anterior.',
      { field: 'startedInProduction' },
    );
  }

  // --- Entradas ya resueltas (con los ceros que impone la posición) ---
  const initialWip = withDefault(input.initialWip, 0);
  const startedInProduction = isFirstDepartment ? withDefault(input.startedInProduction, 0) : new Decimal(0);
  const receivedFromPrevious = isFirstDepartment ? new Decimal(0) : withDefault(input.receivedFromPrevious, 0);
  const unitIncrease = isFirstDepartment ? new Decimal(0) : withDefault(input.unitIncrease, 0);

  // --- R2/R3: pérdidas normales y extraordinarias (delegadas a B08) ---
  // La regla de pérdidas —base "unidades del período" según la posición, y la
  // extraordinaria por diferencia— vive en UN solo lugar (`calcNormalAndExtraordinaryLosses`).
  // El cuadro solo consume las cantidades ya resueltas. Se pasan las entradas ya
  // corregidas por posición: la base "unidades del período" (que NUNCA incluye la
  // EI) queda idéntica sin duplicar la regla.
  const { periodUnits, normalLoss, extraordinaryLoss } = calcNormalAndExtraordinaryLosses({
    sequence: input.sequence,
    startedInProduction,
    receivedFromPrevious,
    unitIncrease,
    normalLossPct: input.normalLossPct,
    totalLossReported: input.totalLossReported,
  });

  // --- Total a justificar (Σ entradas) ---
  const totalToAccount = initialWip
    .plus(startedInProduction)
    .plus(receivedFromPrevious)
    .plus(unitIncrease);

  // --- Salidas conocidas (todas menos las dos derivables) ---
  const finishedInStock = withDefault(input.finishedInStock, 0);
  const knownOutputs = finishedInStock.plus(normalLoss).plus(extraordinaryLoss);

  // --- R1: derivar por diferencia. transferredOut y finalWip son las dos
  // derivables; nunca pueden faltar las dos a la vez (dos incógnitas). ---
  const providedTransferred = opt(input.transferredOut);
  const providedFinalWip = opt(input.finalWip);

  let transferredOut: Decimal;
  let finalWip: Decimal;

  if (providedTransferred !== undefined && providedFinalWip !== undefined) {
    // Ambas dadas: no se deriva nada; el balance se verifica en R5.
    transferredOut = providedTransferred;
    finalWip = providedFinalWip;
  } else if (providedTransferred !== undefined) {
    transferredOut = providedTransferred;
    finalWip = totalToAccount.minus(transferredOut).minus(knownOutputs);
    assertNonNegativeDerived(finalWip, 'existencia final (EF)', 'finalWip');
  } else if (providedFinalWip !== undefined) {
    finalWip = providedFinalWip;
    transferredOut = totalToAccount.minus(finalWip).minus(knownOutputs);
    assertNonNegativeDerived(transferredOut, 'terminadas y transferidas', 'transferredOut');
  } else {
    throw new ProcessValidationError(
      'Faltan dos datos a la vez (terminadas y transferidas Y existencia final): no se puede derivar por diferencia. ' +
        'Cargá al menos uno de los dos.',
      { field: 'transferredOut' },
    );
  }

  // --- Total justificado (Σ salidas) ---
  const totalAccounted = transferredOut
    .plus(finishedInStock)
    .plus(normalLoss)
    .plus(extraordinaryLoss)
    .plus(finalWip);

  // --- R5: chequeo duro final. Σ a justificar = Σ justificado. ---
  const difference = totalToAccount.minus(totalAccounted);
  if (!difference.isZero()) {
    throw new ProcessValidationError(
      `El cuadro no cuadra: unidades a justificar (${totalToAccount.toString()}) ≠ unidades justificadas ` +
        `(${totalAccounted.toString()}). Diferencia: ${difference.toString()} unidades.`,
      { difference: difference.toNumber(), totalToAccount: totalToAccount.toNumber(), totalAccounted: totalAccounted.toNumber() },
    );
  }

  return {
    initialWip,
    startedInProduction,
    receivedFromPrevious,
    unitIncrease,
    periodUnits,
    transferredOut,
    finishedInStock,
    normalLoss,
    extraordinaryLoss,
    finalWip,
    totalToAccount,
    totalAccounted,
  };
}

/* ========================================================================== *
 * COSTEO POR PROCESOS · PRODUCCIÓN EQUIVALENTE (B07)
 * ========================================================================== */

/**
 * Elemento del costo (o agrupación) que encabeza una columna de la producción
 * equivalente. La cátedra sigue tres elementos —MP (materia prima), MOD (mano
 * de obra directa) y CIP (costos indirectos de producción)— y, cuando MOD y CIP
 * comparten grado de avance, los unifica en una sola columna "Costo de
 * Conversión (CC)".
 */
export type EquivalentProductionElement = 'MP' | 'MOD' | 'CIP' | 'CC';

/**
 * Una columna del cuadro de producción equivalente: un elemento del costo con
 * el grado de avance que se aplicó a la existencia final y la producción
 * realmente procesada (equivalente) resultante.
 */
export interface EquivalentProductionColumn {
  /** Elemento (o agrupación CC) que encabeza la columna. */
  element: EquivalentProductionElement;
  /** Etiqueta de la cátedra, tal cual se muestra en la hoja de costos. */
  label: string;
  /** Grado de avance de la EF aplicado en esta columna, como FRACCIÓN (0.80 = 80 %). */
  finalWipAvance: Decimal;
  /** Producción realmente procesada (equivalente) del elemento, en unidades. */
  equivalentUnits: Decimal;
}

/**
 * Cuadro de producción equivalente resuelto: una columna por elemento del costo
 * (dos si MOD y CIP van unificados en CC; tres si van separados), más las
 * unidades que entran al 100 % —comunes a todas las columnas— para que el
 * llamador arme la hoja de costos y verifique el cálculo.
 */
export interface EquivalentProductionSchedule {
  /** Columnas en el orden de la cátedra: MP primero, luego CC o MOD/CIP. */
  columns: EquivalentProductionColumn[];
  /**
   * Unidades computadas al 100 % en TODAS las columnas: terminadas y
   * transferidas + terminadas en existencia + pérdidas extraordinarias (R2).
   * Las pérdidas normales NO entran (R1).
   */
  unitsAtFullCompletion: Decimal;
}

/** Insumos comunes a las dos formas de agrupar la conversión. */
interface EquivalentProductionInputBase {
  /** Cuadro de movimiento de unidades ya resuelto (`buildUnitMovementSchedule`, B06). */
  schedule: UnitMovementSchedule;
  /**
   * Grado de avance de la EF en Materia Prima, como FRACCIÓN. La MP se
   * incorpora al inicio del proceso, así que por DEFAULT es 1 (100 %); se puede
   * sobrescribir cuando la MP no está toda al inicio (R3).
   */
  mpAvance?: Decimal.Value;
}

/**
 * Insumos de la producción equivalente. La forma de agrupar MOD y CIP la decide
 * la configuración del departamento (`ProcessDepartment.defaultConversionAvanceEqualsMO`):
 *
 *  - `conversionUnified: true`  → MOD y CIP comparten avance ⇒ una sola columna
 *    "Costo de Conversión (CC)".
 *  - `conversionUnified: false` → avances distintos ⇒ columnas MOD y CIP separadas.
 *
 * Todos los grados de avance van como FRACCIÓN (0.80 = 80 %) por coherencia con
 * `normalLossPct` del cuadro (B06).
 */
export type EquivalentProductionInput =
  | (EquivalentProductionInputBase & {
      conversionUnified: true;
      /** Grado de avance de la EF en la conversión (MOD = CIP), como fracción. */
      conversionAvance: Decimal.Value;
    })
  | (EquivalentProductionInputBase & {
      conversionUnified: false;
      /** Grado de avance de la EF en Mano de Obra Directa, como fracción. */
      modAvance: Decimal.Value;
      /** Grado de avance de la EF en Costos Indirectos de Producción, como fracción. */
      cipAvance: Decimal.Value;
    });

/** Etiquetas de la cátedra para cada columna. */
const ELEMENT_LABELS: Record<EquivalentProductionElement, string> = {
  MP: 'Materia Prima (MP)',
  MOD: 'Mano de Obra Directa (MOD)',
  CIP: 'Costos Indirectos de Producción (CIP)',
  CC: 'Costo de Conversión (CC)',
};

/**
 * PRODUCCIÓN EQUIVALENTE de un departamento para un período (B07).
 *
 * Expresa, en términos de unidades terminadas, cuánto se procesó realmente en
 * el período. Se computa UNA COLUMNA POR ELEMENTO DEL COSTO. Para cada columna:
 *
 *   Terminadas y transferidas   × 100 %
 *   Terminadas en existencia    × 100 %
 *   Pérdidas extraordinarias    × 100 %   (primero se terminan, después se pierden)
 *   Existencia final (EF)       × (grado de avance de ESE elemento)
 *   ─────────────────────────────────────
 *   = Producción realmente procesada (equivalente) del elemento
 *
 * Reglas (source of truth: cátedra; ver DECISIONES.md B07):
 *  - R1: las pérdidas NORMALES no entran (las absorben las unidades buenas).
 *  - R2: las pérdidas EXTRAORDINARIAS sí entran, al 100 %.
 *  - R3: la MP va al 100 % en la EF por default (se incorpora al inicio),
 *        salvo que se informe otro `mpAvance`.
 *  - R4: la EF es la ÚNICA fila multiplicada por un grado de avance; todas las
 *        demás filas van al 100 %.
 *
 * Función PURA: sin Prisma, sin HTTP, sin servicios. Lanza `ProcessValidationError`
 * (422) si algún grado de avance cae fuera de [0, 1] — nunca un 500 crudo.
 *
 * Caso ancla: Azur Alcoholes, Destilado, abril → MP 34.400 / CC 33.720.
 */
export function calcEquivalentProduction(
  input: EquivalentProductionInput,
): EquivalentProductionSchedule {
  const { schedule } = input;

  // --- Unidades al 100 %, comunes a todas las columnas (R1, R2, R4) ---
  // Terminadas y transferidas + terminadas en existencia + pérdidas
  // extraordinarias. Las pérdidas normales quedan afuera a propósito (R1).
  const unitsAtFullCompletion = schedule.transferredOut
    .plus(schedule.finishedInStock)
    .plus(schedule.extraordinaryLoss);

  const finalWip = schedule.finalWip;

  // --- PE de un elemento = unidades al 100 % + EF × avance del elemento (R4) ---
  const equivalentUnitsFor = (avance: Decimal): Decimal =>
    unitsAtFullCompletion.plus(finalWip.times(avance));

  // R3: MP al 100 % por default, overridable.
  const mpAvance = validateAvance(withDefault(input.mpAvance, 1), 'materia prima', 'mpAvance');

  const columns: EquivalentProductionColumn[] = [
    {
      element: 'MP',
      label: ELEMENT_LABELS.MP,
      finalWipAvance: mpAvance,
      equivalentUnits: equivalentUnitsFor(mpAvance),
    },
  ];

  if (input.conversionUnified) {
    // MOD y CIP comparten avance ⇒ una sola columna "Costo de Conversión (CC)".
    const ccAvance = validateAvance(new Decimal(input.conversionAvance), 'costo de conversión', 'conversionAvance');
    columns.push({
      element: 'CC',
      label: ELEMENT_LABELS.CC,
      finalWipAvance: ccAvance,
      equivalentUnits: equivalentUnitsFor(ccAvance),
    });
  } else {
    // Avances distintos ⇒ columnas MOD y CIP separadas.
    const modAvance = validateAvance(new Decimal(input.modAvance), 'mano de obra directa', 'modAvance');
    const cipAvance = validateAvance(new Decimal(input.cipAvance), 'costos indirectos de producción', 'cipAvance');
    columns.push(
      {
        element: 'MOD',
        label: ELEMENT_LABELS.MOD,
        finalWipAvance: modAvance,
        equivalentUnits: equivalentUnitsFor(modAvance),
      },
      {
        element: 'CIP',
        label: ELEMENT_LABELS.CIP,
        finalWipAvance: cipAvance,
        equivalentUnits: equivalentUnitsFor(cipAvance),
      },
    );
  }

  return { columns, unitsAtFullCompletion };
}

/**
 * Un grado de avance es una FRACCIÓN en [0, 1]. Fuera de ese rango casi siempre
 * significa que se cargó un porcentaje (80) en lugar de la fracción (0.80): se
 * corta con un 422 accionable en vez de arrastrar un cálculo silenciosamente mal.
 */
function validateAvance(avance: Decimal, label: string, field: string): Decimal {
  if (avance.lt(0) || avance.gt(1)) {
    throw new ProcessValidationError(
      `El grado de avance de ${label} (${avance.toString()}) debe estar entre 0 y 1 ` +
        '(es una fracción: 0.80 = 80 %). Revisá el valor cargado.',
      { field, avance: avance.toNumber() },
    );
  }
  return avance;
}

/**
 * Un valor derivado por diferencia que sale negativo significa que las salidas
 * conocidas ya superan a las entradas: el cuadro es imposible.
 */
function assertNonNegativeDerived(value: Decimal, label: string, field: string): void {
  if (value.isNegative()) {
    throw new ProcessValidationError(
      `Las salidas informadas superan a las unidades a justificar: al derivar ${label} da ${value.toString()} unidades (negativo). ` +
        'Revisá las cantidades cargadas.',
      { field, derived: value.toNumber() },
    );
  }
}
