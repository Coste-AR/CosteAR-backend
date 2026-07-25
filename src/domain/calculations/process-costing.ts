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

/* ========================================================================== *
 * COSTEO POR PROCESOS · COSTO TRANSFERIDO = COSTO MODIFICADO + CAUP (B09)
 * ========================================================================== */

/**
 * Insumos del costo unitario que un departamento lleva HACIA ADELANTE, al
 * siguiente ("costo del departamento anterior"). Combina dos ajustes
 * INDEPENDIENTES y ORDENADOS: el costo modificado (Paso 1) y el CAUP (Paso 2).
 *
 * Cantidades en unidades; costos TOTALES (no unitarios) salvo `previousUnitCost`.
 */
export interface TransferredCostInput {
  /** Posición del departamento RECEPTOR en la cadena. El CAUP solo existe en seq > 1. */
  sequence: number;
  /**
   * Costo UNITARIO del departamento anterior (el "previo"), tal como venía antes
   * de recalcular. Se usa: (a) DIRECTO cuando no hay ni existencia inicial ni
   * aumento (sin modificación); (b) como COTA DE CONTROL cuando hay aumento (el
   * costo modificado debe diluir estrictamente por debajo de este valor).
   */
  previousUnitCost: Decimal.Value;

  // --- Paso 1 · costo modificado ---
  /** Costo TOTAL de la existencia inicial (EI) proveniente del depto. anterior. Default 0. */
  initialWipTransferredCost?: Decimal.Value;
  /** Unidades de existencia inicial recibidas del depto. anterior en su momento. Default 0. */
  initialWipUnits?: Decimal.Value;
  /** Costo TOTAL transferido del depto. anterior EN EL PERÍODO (del mes). Default 0. */
  previousPeriodTransferredCost?: Decimal.Value;
  /** Unidades recibidas del depto. anterior EN EL PERÍODO. Default 0. */
  receivedUnits?: Decimal.Value;
  /** Aumento de número de unidades (agua, etc.) — solo seq > 1. Default 0. */
  unitIncrease?: Decimal.Value;

  // --- Paso 2 · CAUP ---
  /**
   * Pérdidas NORMALES del departamento (unidades). Las extraordinarias NO entran
   * acá: son unidades buenas (se terminaron y luego se perdieron). Default 0.
   */
  normalLossUnits?: Decimal.Value;
}

/**
 * Costo transferido resuelto. Trae los tres números centrales de la cátedra
 * —costo modificado (Paso 1), CAUP (Paso 2) y costo transferido (la suma)— más
 * los intermedios (unidades a justificar, unidades buenas, costo de la pérdida)
 * y las banderas de qué pasos se aplicaron, para que el informe (B10) y el motor
 * (B17) muestren el detalle sin recalcular.
 */
export interface TransferredCost {
  /** Paso 1 · costo unitario del depto. anterior RECALCULADO (o el previo, sin modificación). */
  costoModificado: Decimal;
  /** Paso 2 · Costo Adicional por Unidades Perdidas (CAUP/CAUO). 0 si no aplica. */
  caup: Decimal;
  /** Costo unitario FINAL del depto. anterior, a transferir = costo modificado + CAUP. */
  costoTransferido: Decimal;
  /** Unidades a justificar = EI + recibidas + aumento (denominador del Paso 1). */
  unidadesAJustificar: Decimal;
  /** Unidades buenas = unidades a justificar − pérdidas normales (denominador del CAUP). */
  unidadesBuenas: Decimal;
  /** Costo de la pérdida = pérdidas normales × costo modificado (numerador del CAUP). */
  costoDeLaPerdida: Decimal;
  /** El Paso 1 MODIFICÓ el costo del anterior (había EI y/o aumento). */
  step1Applied: boolean;
  /** El Paso 2 (CAUP) se aplicó (depto. posterior con pérdidas normales). */
  step2Applied: boolean;
}

/**
 * COSTO TRANSFERIDO de un departamento al siguiente (B09) — la parte más
 * delicada de todo el motor de Procesos, por eso la matriz de 4 combinaciones se
 * implementa como CUATRO RAMAS EXPLÍCITAS, cada una con su test.
 *
 * El costo que un departamento arrastra hacia adelante ("costo del departamento
 * anterior") NO es el costo unitario tal cual: se recalcula por DOS ajustes
 * independientes y ORDENADOS.
 *
 * PASO 1 — COSTO MODIFICADO (recalcula el costo unitario del anterior cuando
 * cambia la cantidad de unidades). Aplica si hay existencia inicial recibida del
 * anterior Y/O aumento de número de unidades:
 *
 *   costo modificado = (costo total EI del anterior + costo total del anterior del mes)
 *                      ÷ (unidades EI + unidades recibidas del período + aumento)
 *
 *   - SIN existencia inicial: el promedio se reduce a costo del período ÷
 *     (recibidas + aumento) — la EI aporta 0 al numerador y 0 al denominador.
 *   - NI EI NI aumento: se usa el costo unitario previo DIRECTO (sin modificación).
 *   - CONTROL (regla de la cátedra): con aumento de unidades, el costo modificado
 *     debe ser ESTRICTAMENTE MENOR que el costo unitario previo (más unidades
 *     diluyen el mismo costo total). Si sale mayor o igual, es un error de carga
 *     ⇒ `ProcessValidationError` (422 accionable en español, nunca un 500).
 *
 * PASO 2 — CAUP (Costo Adicional por Unidades Perdidas; sinónimo CAUO). Aplica
 * SOLO en departamentos posteriores (seq > 1) y SOLO si hay pérdidas normales:
 *
 *   costo de la pérdida = pérdidas normales × costo modificado
 *   unidades buenas     = unidades a justificar − pérdidas normales
 *   CAUP                = costo de la pérdida ÷ unidades buenas
 *
 *   (Las pérdidas EXTRAORDINARIAS son unidades buenas: se terminaron y después se
 *   perdieron; las ÚNICAS unidades "malas" acá son las pérdidas normales.)
 *
 *   costo transferido = costo modificado + CAUP
 *
 * MATRIZ DE 4 COMBINACIONES (una rama explícita, un test por celda):
 *   ┌───────────┬───────────┬─────────────────────────────────────────────────┐
 *   │ aumento   │ pérd.norm │ qué se computa                                   │
 *   ├───────────┼───────────┼─────────────────────────────────────────────────┤
 *   │ Sí        │ No        │ Paso 1 solo (costo modificado)                   │
 *   │ No        │ Sí        │ Paso 1 (promedio con EI si la hay) + Paso 2      │
 *   │ Sí        │ Sí        │ Paso 1 y Paso 2, EN ESE ORDEN (caso ancla)       │
 *   │ No        │ No        │ costo unitario previo directo (sin Paso 1 ni 2)  │
 *   └───────────┴───────────┴─────────────────────────────────────────────────┘
 *
 * Función PURA: sin Prisma, sin HTTP, sin servicios.
 *
 * Caso ancla (Azur Alcoholes, Purificado, abril): EI $11.120 + período $112.500
 * = $123.620 ÷ 35.320 unidades a justificar → costo modificado $3,50 (< $3,75
 * previo ✓); pérdidas normales 320 → costo de la pérdida $1.120, unidades buenas
 * 35.000, CAUP $0,032; costo transferido $3,50 + $0,032 = $3,532.
 */
export function calcTransferredCost(input: TransferredCostInput): TransferredCost {
  const previousUnitCost = new Decimal(input.previousUnitCost);

  const initialWipTransferredCost = withDefault(input.initialWipTransferredCost, 0);
  const initialWipUnits = withDefault(input.initialWipUnits, 0);
  const previousPeriodTransferredCost = withDefault(input.previousPeriodTransferredCost, 0);
  const receivedUnits = withDefault(input.receivedUnits, 0);
  const unitIncrease = withDefault(input.unitIncrease, 0);
  const normalLossUnits = withDefault(input.normalLossUnits, 0);

  // Denominador del Paso 1 y, a la vez, las "unidades a justificar" que usa el
  // CAUP: es la MISMA cantidad, así los dos pasos nunca divergen.
  const unidadesAJustificar = initialWipUnits.plus(receivedUnits).plus(unitIncrease);

  // Los dos EJES de la matriz.
  const hasUnitIncrease = unitIncrease.gt(0);
  const hasNormalLoss = normalLossUnits.gt(0);
  // El Paso 1 modifica el costo cuando hay EI y/o aumento (source of truth). La
  // EI se detecta por sus unidades: sin unidades no hay existencia inicial.
  const step1Modifies = initialWipUnits.gt(0) || hasUnitIncrease;
  // El CAUP solo existe en departamentos posteriores con pérdidas normales.
  const step2Caup = input.sequence > 1 && hasNormalLoss;

  // --- Paso 1 · costo modificado (una sola definición, honra el source of truth) ---
  const computeCostoModificado = (): Decimal => {
    if (!step1Modifies) {
      // Ni EI ni aumento: se usa el costo unitario previo, sin modificación.
      return previousUnitCost;
    }
    if (unidadesAJustificar.isZero()) {
      throw new ProcessValidationError(
        'No se puede recalcular el costo modificado con 0 unidades a justificar (EI + recibidas + aumento). ' +
          'Revisá las unidades cargadas del departamento.',
        { field: 'receivedUnits' },
      );
    }
    // Promedio ponderado: (costo total EI + costo total del período) ÷ (EI + recibidas + aumento).
    return initialWipTransferredCost.plus(previousPeriodTransferredCost).div(unidadesAJustificar);
  };

  // --- Control de la cátedra: con aumento, el modificado debe diluir el costo ---
  const assertDilution = (costoModificado: Decimal): void => {
    if (hasUnitIncrease && costoModificado.gte(previousUnitCost)) {
      throw new ProcessValidationError(
        `Con aumento de número de unidades, el costo modificado (${costoModificado.toString()}) debe ser ` +
          `ESTRICTAMENTE MENOR que el costo unitario previo (${previousUnitCost.toString()}): al agregar unidades, ` +
          'el mismo costo total se diluye. Si sale mayor o igual, hay un error de carga en los costos o las unidades.',
        {
          field: 'unitIncrease',
          costoModificado: costoModificado.toNumber(),
          previousUnitCost: previousUnitCost.toNumber(),
        },
      );
    }
  };

  // --- Paso 2 · CAUP (una sola definición) ---
  const computeCaup = (costoModificado: Decimal): Decimal => {
    const unidadesBuenas = unidadesAJustificar.minus(normalLossUnits);
    if (unidadesBuenas.lte(0)) {
      throw new ProcessValidationError(
        `El CAUP no se puede repartir: las unidades buenas (unidades a justificar ${unidadesAJustificar.toString()} ` +
          `− pérdidas normales ${normalLossUnits.toString()}) dan ${unidadesBuenas.toString()}. ` +
          'Revisá las pérdidas normales cargadas.',
        { field: 'normalLossUnits', unidadesBuenas: unidadesBuenas.toNumber() },
      );
    }
    // costo de la pérdida ÷ unidades buenas = pérdidas normales × costo modificado ÷ unidades buenas.
    return normalLossUnits.times(costoModificado).div(unidadesBuenas);
  };

  // Arma la salida de forma uniforme (las intermedias se derivan una sola vez).
  const assemble = (costoModificado: Decimal, caup: Decimal, step1Applied: boolean, step2Applied: boolean): TransferredCost => ({
    costoModificado,
    caup,
    costoTransferido: costoModificado.plus(caup),
    unidadesAJustificar,
    unidadesBuenas: unidadesAJustificar.minus(normalLossUnits),
    costoDeLaPerdida: normalLossUnits.times(costoModificado),
    step1Applied,
    step2Applied,
  });

  const zero = new Decimal(0);

  // ---------------------- MATRIZ DE 4 COMBINACIONES ------------------------- //
  // Ramas EXPLÍCITAS por celda de la matriz (aumento × pérdidas normales), una y
  // una sola por combinación. El manejo de la EI vive dentro del Paso 1
  // (computeCostoModificado): "promedio con EI si la hay, si no el costo previo".

  if (hasUnitIncrease && !hasNormalLoss) {
    // Combo (aumento Sí, normales No): Paso 1 solo (costo modificado, sin CAUP).
    const costoModificado = computeCostoModificado();
    assertDilution(costoModificado);
    return assemble(costoModificado, zero, step1Modifies, false);
  }

  if (!hasUnitIncrease && hasNormalLoss) {
    // Combo (aumento No, normales Sí): Paso 1 (promedio con EI si la hay) + Paso 2 (CAUP).
    const costoModificado = computeCostoModificado();
    const caup = step2Caup ? computeCaup(costoModificado) : zero;
    return assemble(costoModificado, caup, step1Modifies, step2Caup);
  }

  if (hasUnitIncrease && hasNormalLoss) {
    // Combo (aumento Sí, normales Sí): Paso 1 y Paso 2, EN ESE ORDEN. Caso ancla Purificado.
    const costoModificado = computeCostoModificado();
    assertDilution(costoModificado);
    const caup = step2Caup ? computeCaup(costoModificado) : zero;
    return assemble(costoModificado, caup, step1Modifies, step2Caup);
  }

  // Combo (aumento No, normales No): sin CAUP. Con EI, el Paso 1 igual promedia
  // (source of truth); sin EI, se usa el costo unitario previo directo.
  return assemble(computeCostoModificado(), zero, step1Modifies, false);
}

/* ========================================================================== *
 * COSTEO POR PROCESOS · INFORME DE COSTOS DE PRODUCCIÓN (B10)
 * ========================================================================== */

/**
 * Tolerancia de redondeo (en pesos) del cierre entre las dos formas de valuar la
 * existencia final. La cátedra acepta un "ajuste" de unos pocos pesos por
 * redondeo de los costos unitarios; un ajuste desproporcionado al total delata
 * un error previo (costos, costo transferido o cuadro de unidades). Se puede
 * sobrescribir por (departamento, período) con `roundingTolerance`.
 */
const DEFAULT_ROUNDING_TOLERANCE = 5;

/**
 * Costo de UN elemento del costo (o de la agrupación CC) que ENTRA al informe.
 * `element` debe coincidir con una columna de la producción equivalente (B07):
 * de ahí sale la producción realmente procesada (denominador del costo unitario)
 * y el grado de avance de la EF (para la valuación por elemento de la Parte 3).
 * Los dos costos son TOTALES en pesos; el informe solo usa la SUMA para el costo
 * unitario (promedio ponderado), pero conserva la apertura porque la hoja de
 * costos la muestra en dos subsecciones.
 */
export interface ProductionCostElementCost {
  /** Elemento (o agrupación CC) que encabeza la columna. Debe existir en la PE (B07). */
  element: EquivalentProductionElement;
  /** Costo TOTAL del inventario inicial de ESE elemento (lo que traían las unidades en proceso). Default 0. */
  costoInventarioInicial?: Decimal.Value;
  /** Costo TOTAL del período de ESE elemento (lo generado durante el mes). Default 0. */
  costoDelPeriodo?: Decimal.Value;
}

/**
 * Sección A · Costo del departamento anterior. Solo existe en departamentos
 * posteriores (seq > 1): es el costo transferido de B09 (costo modificado + CAUP)
 * y el costo total acumulado que arrastra ese departamento hacia adelante.
 */
export interface PreviousDepartmentCostInput {
  /** Costo UNITARIO transferido del depto. anterior (B09 `costoTransferido`). */
  costoUnitarioTransferido: Decimal.Value;
  /**
   * Costo TOTAL del departamento anterior acumulado en este departamento
   * (unidades buenas × costo transferido, de B09). Es la Sección A del costo a
   * justificar. Se pasa explícito para no reconstruir la semántica del CAUP acá.
   */
  costoTotal: Decimal.Value;
}

/**
 * Insumos del informe de costos de un (departamento, período). Es un ENSAMBLADOR
 * puro: toma el cuadro de unidades (B06), la producción equivalente (B07) y los
 * costos por elemento (más el costo transferido de B09 en seq > 1) ya resueltos,
 * y arma la hoja de costos. No recalcula ninguno de esos insumos.
 */
export interface ProductionCostReportInput {
  /** Posición del departamento en la cadena. 1 = departamento inicial (sin Sección A). */
  sequence: number;
  /** Cuadro de movimiento de unidades ya resuelto (`buildUnitMovementSchedule`, B06). */
  schedule: UnitMovementSchedule;
  /** Producción equivalente ya resuelta (`calcEquivalentProduction`, B07). */
  equivalentProduction: EquivalentProductionSchedule;
  /** Costos por elemento (uno por columna de la producción equivalente). */
  elementCosts: ProductionCostElementCost[];
  /** Sección A — costo del departamento anterior. OBLIGATORIO en seq > 1, PROHIBIDO en seq 1. */
  previousDepartmentCost?: PreviousDepartmentCostInput;
  /** Tolerancia de redondeo (pesos) del cierre de la Parte 3. Default 5. */
  roundingTolerance?: Decimal.Value;
}

/** Línea de un elemento del costo en el informe (Sección B + verificación de la Parte 3). */
export interface ProductionCostElementLine {
  element: EquivalentProductionElement;
  /** Etiqueta de la cátedra (viene de la columna de la PE). */
  label: string;
  /** Costo del inventario inicial del elemento. */
  costoInventarioInicial: Decimal;
  /** Costo del período del elemento. */
  costoDelPeriodo: Decimal;
  /** Costo total del elemento = inventario inicial + período. */
  costoTotal: Decimal;
  /** Producción realmente procesada del elemento (equivalente, de B07). */
  produccionProcesada: Decimal;
  /** Costo unitario del elemento = costo total ÷ producción procesada (promedio ponderado). */
  costoUnitario: Decimal;
  /** Parte 3 · unidades equivalentes de la EF del elemento = EF × grado de avance. */
  unidadesEquivalentesEF: Decimal;
  /** Parte 3 · valuación de la EF del elemento = unidades equivalentes × costo unitario. */
  valuacionEF: Decimal;
}

/** Sección A resuelta (solo seq > 1). */
export interface PreviousDepartmentLine {
  /** Costo unitario transferido del depto. anterior (B09). */
  costoUnitarioTransferido: Decimal;
  /** Costo total acumulado del depto. anterior (Sección A del costo a justificar). */
  costoTotal: Decimal;
  /** Parte 3 · unidades de la EF valuadas al costo del anterior (SIEMPRE al 100 %). */
  unidadesEF: Decimal;
  /** Parte 3 · valuación de la EF al costo del anterior = EF × costo transferido. */
  valuacionEF: Decimal;
}

/**
 * Hoja de costos resuelta de un departamento para un período: las TRES partes de
 * la cátedra (costo a justificar, justificación y valuación de la existencia
 * final), con el ajuste por redondeo del cierre ya verificado. NUNCA se devuelve
 * un informe inconsistente: si las dos formas de valuar la EF difieren más que la
 * tolerancia, `buildProductionCostReport` lanza `ProcessValidationError`.
 */
export interface ProductionCostReport {
  sequence: number;

  // --- PARTE 1 · COSTO A JUSTIFICAR ---
  /** Sección A · costo del departamento anterior. `undefined` en el depto. inicial (seq 1). */
  previousDepartment?: PreviousDepartmentLine;
  /** Sección B · una línea por elemento del costo, en el orden de la cátedra (MP primero). */
  elements: ProductionCostElementLine[];
  /** Costo unitario total acumulado = Σ costos unitarios de los elementos (+ costo transferido en seq > 1). */
  costoUnitarioTotalAcumulado: Decimal;
  /** Costo acumulado a justificar = Σ costos totales (Sección A + Sección B). */
  costoAcumuladoAJustificar: Decimal;

  // --- PARTE 2 · JUSTIFICACIÓN DEL COSTO ---
  /** Terminadas y transferidas × costo unitario total acumulado. */
  costoTerminadasYTransferidas: Decimal;
  /** Terminadas en existencia (stock) × costo unitario total acumulado. */
  costoTerminadasEnStock: Decimal;
  /** Pérdidas extraordinarias × costo unitario total acumulado. */
  costoPerdidasExtraordinarias: Decimal;
  /** Existencia final de producción en proceso, POR DIFERENCIA (la EF oficial del informe). */
  costoExistenciaFinalPorDiferencia: Decimal;
  /** Σ de la justificación (= costo acumulado a justificar; el informe SIEMPRE cuadra). */
  totalJustificado: Decimal;

  // --- PARTE 3 · VALUACIÓN DE LA EXISTENCIA FINAL (verificación) ---
  /** EF recomputada por elemento (Σ elementos + depto. anterior), antes del ajuste. */
  valuacionExistenciaFinalPorElemento: Decimal;
  /**
   * Ajuste por redondeo = EF por diferencia − EF por elemento. Dentro de la
   * tolerancia; recorta el residuo de redondear los costos unitarios. Un ajuste
   * mayor a la tolerancia NO llega acá: la función lanza antes.
   */
  ajustePorRedondeo: Decimal;
}

/**
 * INFORME DE COSTOS DE PRODUCCIÓN de un departamento para un período (B10).
 *
 * Cierra la matemática por departamento: ensambla la hoja de costos —los números
 * finales valuados— a partir de las piezas de B06-B09. Función ENSAMBLADORA
 * pura: no recalcula el cuadro de unidades, la producción equivalente ni el costo
 * transferido; los toma ya resueltos y los combina.
 *
 * La hoja tiene TRES partes (source of truth: cátedra; ver DECISIONES.md B10):
 *
 * PARTE 1 — COSTO A JUSTIFICAR (cuánto costó producir todo lo que tenemos):
 *   · Sección A — costo del departamento anterior: SOLO seq > 1 (en blanco en el
 *     inicial). Es el costo transferido de B09.
 *   · Sección B — costos del departamento (todos), abiertos por elemento en dos
 *     subsecciones (inventario inicial y período).
 *   · Costo unitario del elemento = (costo inv. inicial + costo del período) ÷
 *     producción realmente procesada del elemento (PROMEDIO PONDERADO, único método acá).
 *   · Costo unitario total acumulado = Σ costos unitarios (+ costo transferido en seq > 1).
 *   · COSTO ACUMULADO A JUSTIFICAR = Σ de todos los costos totales.
 *
 * PARTE 2 — JUSTIFICACIÓN DEL COSTO (a dónde fue ese costo; debe IGUALAR la Parte 1):
 *   · Terminadas y transferidas × costo unitario total acumulado.
 *   · Terminadas en stock × costo unitario total acumulado.
 *   · Pérdidas extraordinarias × costo unitario total acumulado.
 *   · Existencia final de producción en proceso → POR DIFERENCIA (costo acumulado a
 *     justificar − las tres líneas anteriores). Es la única línea que no se computa
 *     directo: las unidades en proceso no están terminadas, no se les aplica el
 *     costo de la unidad terminada.
 *
 * PARTE 3 — VALUACIÓN DE LA EXISTENCIA FINAL (verificación de la Parte 2):
 *   Recomputa la EF por el OTRO camino, por elemento:
 *     Σ (unidades equivalentes de la EF del elemento × costo unitario del elemento)
 *     (+ en seq > 1) unidades EF × costo transferido del anterior (SIEMPRE al 100 %).
 *   ASSERTION DURA: esta valuación por elemento DEBE igualar la EF por diferencia
 *   de la Parte 2 dentro de una tolerancia de redondeo (unos pocos pesos). Si NO
 *   coinciden ⇒ `ProcessValidationError` (422 accionable en español). NUNCA se
 *   devuelve un informe inconsistente. Un ajuste de pocos pesos por redondeo se
 *   acepta y se registra (`ajustePorRedondeo`); uno desproporcionado al total
 *   delata un error previo y corta.
 *
 * Función PURA: sin Prisma, sin HTTP, sin servicios. Lanza `ProcessValidationError`
 * (422) — nunca un 500 crudo.
 *
 * Casos ancla (Azur Alcoholes, abril):
 *  - Destilado (seq 1): costo unitario MP $2,00 + CC $1,75 = $3,75; costo acumulado a
 *    justificar $127.810; EF por diferencia $11.560 = por elemento (MP 3.400×$2,00 +
 *    CC 2.720×$1,75) ✓.
 *  - Purificado (seq 2): costo unitario total $6,532 ($3,532 transferido + $1,00 MP +
 *    $2,00 CC); EF por elemento $31.992 (anterior 6.000×$3,532 + MP 6.000×$1,00 +
 *    CC 2.400×$2,00) ✓.
 */
export function buildProductionCostReport(input: ProductionCostReportInput): ProductionCostReport {
  const isFirstDepartment = input.sequence === 1;

  // --- Coherencia de la Sección A según la posición del departamento ---
  if (isFirstDepartment && input.previousDepartmentCost) {
    throw new ProcessValidationError(
      'El departamento inicial (secuencia 1) no tiene costo del departamento anterior (Sección A); no debe informarse.',
      { field: 'previousDepartmentCost' },
    );
  }
  if (!isFirstDepartment && !input.previousDepartmentCost) {
    throw new ProcessValidationError(
      'Falta el costo del departamento anterior (Sección A) de un departamento posterior (secuencia > 1). ' +
        'Es el costo transferido del departamento previo (B09).',
      { field: 'previousDepartmentCost' },
    );
  }

  // --- PARTE 1 · Sección B · líneas por elemento (en el orden de la PE: MP primero) ---
  // Cada columna de la producción equivalente aporta la producción procesada y el
  // grado de avance de la EF; se busca su costo por elemento (mismo `element`).
  const columns = input.equivalentProduction.columns;
  if (input.elementCosts.length !== columns.length) {
    throw new ProcessValidationError(
      `Los costos por elemento (${input.elementCosts.length}) no coinciden con las columnas de la producción ` +
        `equivalente (${columns.length}). Debe haber un costo por cada elemento del cuadro.`,
      { field: 'elementCosts' },
    );
  }

  const finalWip = input.schedule.finalWip;

  const elements: ProductionCostElementLine[] = columns.map((column) => {
    const cost = input.elementCosts.find((c) => c.element === column.element);
    if (!cost) {
      throw new ProcessValidationError(
        `Falta el costo del elemento ${column.element} presente en la producción equivalente. ` +
          'Cargá el costo (inventario inicial y período) de ese elemento.',
        { field: 'elementCosts' },
      );
    }

    const costoInventarioInicial = withDefault(cost.costoInventarioInicial, 0);
    const costoDelPeriodo = withDefault(cost.costoDelPeriodo, 0);
    const costoTotal = costoInventarioInicial.plus(costoDelPeriodo);
    const produccionProcesada = column.equivalentUnits;

    // Costo unitario = costo total ÷ producción procesada (promedio ponderado). Sin
    // producción procesada no se puede repartir un costo > 0 (evita dividir por cero).
    if (produccionProcesada.isZero()) {
      if (!costoTotal.isZero()) {
        throw new ProcessValidationError(
          `El elemento ${column.element} tiene costo ($${costoTotal.toString()}) pero 0 unidades de producción ` +
            'procesada: no se puede calcular su costo unitario. Revisá el cuadro de unidades y la producción equivalente.',
          { field: 'elementCosts', element: column.element },
        );
      }
      // 0 costo y 0 producción: elemento inerte, costo unitario 0.
    }
    const costoUnitario = produccionProcesada.isZero()
      ? new Decimal(0)
      : costoTotal.div(produccionProcesada);

    // Parte 3 · unidades equivalentes de la EF del elemento = EF × grado de avance.
    const unidadesEquivalentesEF = finalWip.times(column.finalWipAvance);
    const valuacionEF = unidadesEquivalentesEF.times(costoUnitario);

    return {
      element: column.element,
      label: column.label,
      costoInventarioInicial,
      costoDelPeriodo,
      costoTotal,
      produccionProcesada,
      costoUnitario,
      unidadesEquivalentesEF,
      valuacionEF,
    };
  });

  // --- PARTE 1 · Sección A · costo del departamento anterior (solo seq > 1) ---
  let previousDepartment: PreviousDepartmentLine | undefined;
  if (input.previousDepartmentCost) {
    const costoUnitarioTransferido = new Decimal(input.previousDepartmentCost.costoUnitarioTransferido);
    const costoTotal = new Decimal(input.previousDepartmentCost.costoTotal);
    previousDepartment = {
      costoUnitarioTransferido,
      costoTotal,
      // La EF del anterior se valúa SIEMPRE al 100 % (las unidades ya vinieron enteras).
      unidadesEF: finalWip,
      valuacionEF: finalWip.times(costoUnitarioTransferido),
    };
  }

  // --- PARTE 1 · totales ---
  const zero = new Decimal(0);
  const costoUnitarioElementos = elements.reduce((acc, e) => acc.plus(e.costoUnitario), zero);
  const costoUnitarioTotalAcumulado = costoUnitarioElementos.plus(
    previousDepartment?.costoUnitarioTransferido ?? zero,
  );

  const costoTotalElementos = elements.reduce((acc, e) => acc.plus(e.costoTotal), zero);
  const costoAcumuladoAJustificar = costoTotalElementos.plus(previousDepartment?.costoTotal ?? zero);

  // --- PARTE 2 · justificación del costo ---
  const costoTerminadasYTransferidas = input.schedule.transferredOut.times(costoUnitarioTotalAcumulado);
  const costoTerminadasEnStock = input.schedule.finishedInStock.times(costoUnitarioTotalAcumulado);
  const costoPerdidasExtraordinarias = input.schedule.extraordinaryLoss.times(costoUnitarioTotalAcumulado);
  // EF POR DIFERENCIA: es la única línea que no se computa directo.
  const costoExistenciaFinalPorDiferencia = costoAcumuladoAJustificar
    .minus(costoTerminadasYTransferidas)
    .minus(costoTerminadasEnStock)
    .minus(costoPerdidasExtraordinarias);

  // --- PARTE 3 · valuación de la EF por elemento (verificación) ---
  const valuacionExistenciaFinalPorElemento = elements
    .reduce((acc, e) => acc.plus(e.valuacionEF), zero)
    .plus(previousDepartment?.valuacionEF ?? zero);

  // --- ASSERTION DURA · las dos formas de valuar la EF deben coincidir ---
  const ajustePorRedondeo = costoExistenciaFinalPorDiferencia.minus(valuacionExistenciaFinalPorElemento);
  const tolerance = withDefault(input.roundingTolerance, DEFAULT_ROUNDING_TOLERANCE);
  if (ajustePorRedondeo.abs().gt(tolerance)) {
    throw new ProcessValidationError(
      `La valuación de la existencia final no cierra: por diferencia da $${costoExistenciaFinalPorDiferencia.toString()} ` +
        `y por elemento $${valuacionExistenciaFinalPorElemento.toString()} (difieren en $${ajustePorRedondeo.toString()}, ` +
        `más que la tolerancia de redondeo de $${tolerance.toString()}). Un ajuste tan grande delata un error previo: ` +
        'revisá los costos por elemento, el costo transferido del departamento anterior o el cuadro de unidades.',
      {
        field: 'elementCosts',
        porDiferencia: costoExistenciaFinalPorDiferencia.toNumber(),
        porElemento: valuacionExistenciaFinalPorElemento.toNumber(),
        ajuste: ajustePorRedondeo.toNumber(),
        tolerancia: tolerance.toNumber(),
      },
    );
  }

  return {
    sequence: input.sequence,
    previousDepartment,
    elements,
    costoUnitarioTotalAcumulado,
    costoAcumuladoAJustificar,
    costoTerminadasYTransferidas,
    costoTerminadasEnStock,
    costoPerdidasExtraordinarias,
    costoExistenciaFinalPorDiferencia,
    // La justificación SIEMPRE cuadra: la EF se derivó por diferencia justamente para eso.
    totalJustificado: costoAcumuladoAJustificar,
    valuacionExistenciaFinalPorElemento,
    ajustePorRedondeo,
  };
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
