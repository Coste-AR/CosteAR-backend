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

  // --- R2: unidades del período (base de la pérdida normal) ---
  // NUNCA se computa el % sobre la EI (esas son unidades del período anterior).
  const periodUnits = isFirstDepartment
    ? startedInProduction
    : receivedFromPrevious.plus(unitIncrease);

  // --- Pérdida normal = % × unidades del período ---
  const normalLossPct = withDefault(input.normalLossPct, 0);
  const normalLoss = normalLossPct.times(periodUnits);

  // --- R3: pérdida extraordinaria = pérdida real total − pérdida normal ---
  // Nunca se ingresa directa. Sin total informado ⇒ no hay extraordinaria.
  const totalLossReported = opt(input.totalLossReported) ?? normalLoss;
  const extraordinaryLoss = totalLossReported.minus(normalLoss);
  if (extraordinaryLoss.isNegative()) {
    throw new ProcessValidationError(
      `La pérdida real total (${totalLossReported.toString()}) es menor que la pérdida normal (${normalLoss.toString()}); ` +
        'la pérdida extraordinaria no puede ser negativa. Revisá el % de pérdida normal o la pérdida total informada.',
      { field: 'totalLossReported', normalLoss: normalLoss.toNumber(), extraordinaryLoss: extraordinaryLoss.toNumber() },
    );
  }

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
