import { describe, it, expect } from 'vitest';
import {
  buildUnitMovementSchedule,
  calcEquivalentProduction,
  calcNormalAndExtraordinaryLosses,
  calcTransferredCost,
  type EquivalentProductionElement,
  type UnitMovementSchedule,
} from '@/domain/calculations/process-costing.js';
import { ProcessValidationError } from '@/domain/errors/calculation-errors.js';

describe('Costeo por Procesos — cuadro de movimiento de unidades (B06)', () => {
  it('resuelve un cuadro balanceado derivando la existencia final por diferencia', () => {
    // Depto. inicial. Se conoce transferredOut; la EF se deriva.
    const r = buildUnitMovementSchedule({
      sequence: 1,
      initialWip: 1000,
      startedInProduction: 9000,
      transferredOut: 8000,
      finishedInStock: 0,
      normalLossPct: 0.05, // 5 % × 9000 = 450
      totalLossReported: 450, // sin extraordinaria
    });

    expect(r.totalToAccount.toNumber()).toBe(10000); // 1000 + 9000
    expect(r.periodUnits.toNumber()).toBe(9000);
    expect(r.normalLoss.toNumber()).toBe(450);
    expect(r.extraordinaryLoss.toNumber()).toBe(0);
    // EF derivada = 10000 − (8000 + 0 + 450 + 0) = 1550
    expect(r.finalWip.toNumber()).toBe(1550);
    expect(r.totalAccounted.toNumber()).toBe(10000);
    // Cuadra.
    expect(r.totalToAccount.toNumber()).toBe(r.totalAccounted.toNumber());
  });

  it('deriva las terminadas y transferidas por diferencia cuando se da la EF', () => {
    // "Grado de avance dado sin cantidad": se conoce la EF, falta transferredOut.
    const r = buildUnitMovementSchedule({
      sequence: 2,
      initialWip: 2000,
      receivedFromPrevious: 12000,
      unitIncrease: 0,
      finishedInStock: 500,
      normalLossPct: 0.1, // 10 % × 12000 = 1200
      totalLossReported: 1200,
      finalWip: 3000,
    });

    expect(r.totalToAccount.toNumber()).toBe(14000); // 2000 + 12000
    expect(r.periodUnits.toNumber()).toBe(12000);
    expect(r.normalLoss.toNumber()).toBe(1200);
    // transferredOut derivada = 14000 − (3000 + 500 + 1200 + 0) = 9300
    expect(r.transferredOut.toNumber()).toBe(9300);
    expect(r.totalAccounted.toNumber()).toBe(14000);
  });

  it('R2: el mismo % de pérdida normal da pérdidas distintas en un depto. inicial vs. uno posterior', () => {
    // Mismos insumos totales (10.000), distinta composición. La base de la
    // pérdida normal NUNCA incluye la EI.
    const primerDepto = buildUnitMovementSchedule({
      sequence: 1,
      initialWip: 2000,
      startedInProduction: 8000, // base = 8000
      transferredOut: 7000,
      normalLossPct: 0.05,
    });
    const deptoPosterior = buildUnitMovementSchedule({
      sequence: 2,
      initialWip: 3000,
      receivedFromPrevious: 6000,
      unitIncrease: 1000, // base = 6000 + 1000 = 7000
      transferredOut: 6000,
      normalLossPct: 0.05,
    });

    expect(primerDepto.periodUnits.toNumber()).toBe(8000);
    expect(deptoPosterior.periodUnits.toNumber()).toBe(7000);
    // Mismo 5 %, distinta base ⇒ distinta pérdida normal.
    expect(primerDepto.normalLoss.toNumber()).toBe(400); // 0.05 × 8000
    expect(deptoPosterior.normalLoss.toNumber()).toBe(350); // 0.05 × 7000
    expect(primerDepto.normalLoss.toNumber()).not.toBe(deptoPosterior.normalLoss.toNumber());
  });

  it('R4: un depto. inicial con "recibidas del anterior" lanza ProcessValidationError', () => {
    expect(() =>
      buildUnitMovementSchedule({
        sequence: 1,
        startedInProduction: 10000,
        receivedFromPrevious: 5000, // no le corresponde
        transferredOut: 9000,
      }),
    ).toThrow(ProcessValidationError);
  });

  it('R4: un depto. inicial con "aumento de unidades" lanza ProcessValidationError', () => {
    expect(() =>
      buildUnitMovementSchedule({
        sequence: 1,
        startedInProduction: 10000,
        unitIncrease: 500, // no le corresponde
        transferredOut: 9000,
      }),
    ).toThrow(ProcessValidationError);
  });

  it('R5: un cuadro desbalanceado lanza ProcessValidationError nombrando la diferencia', () => {
    // Ambas salidas derivables dadas ⇒ el balance se chequea de verdad.
    let error: unknown;
    try {
      buildUnitMovementSchedule({
        sequence: 1,
        initialWip: 1000,
        startedInProduction: 9000, // a justificar = 10000
        transferredOut: 8000,
        finishedInStock: 0,
        normalLossPct: 0,
        finalWip: 1500, // justificado = 9500 ≠ 10000
      });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ProcessValidationError);
    const err = error as ProcessValidationError;
    expect(err.message).toContain('no cuadra');
    // La diferencia (500) viaja en details para el indicador del front.
    expect((err.details as { difference: number }).difference).toBe(500);
  });

  it('R1: faltando las dos derivables a la vez (transferidas Y EF) lanza ProcessValidationError', () => {
    expect(() =>
      buildUnitMovementSchedule({
        sequence: 1,
        initialWip: 1000,
        startedInProduction: 9000,
        // ni transferredOut ni finalWip → dos incógnitas
      }),
    ).toThrow(ProcessValidationError);
  });

  it('Caso ancla — Azur Alcoholes, Destilado, abril', () => {
    // EI 5.000 + puestas 30.000 = 35.000 a justificar.
    // Terminadas y transferidas 30.000; pérdida normal 2 % × 30.000 = 600;
    // pérdida extraordinaria 1.000 (⇒ pérdida real total = 600 + 1.000 = 1.600);
    // existencia final 3.400. 30.000 + 600 + 1.000 + 3.400 = 35.000 ✓.
    const r = buildUnitMovementSchedule({
      sequence: 1,
      initialWip: 5000,
      startedInProduction: 30000,
      transferredOut: 30000,
      finishedInStock: 0,
      normalLossPct: 0.02,
      totalLossReported: 1600, // 600 normal + 1000 extraordinaria
      // finalWip se deriva por diferencia
    });

    expect(r.totalToAccount.toNumber()).toBe(35000);
    expect(r.periodUnits.toNumber()).toBe(30000);
    expect(r.normalLoss.toNumber()).toBe(600);
    expect(r.extraordinaryLoss.toNumber()).toBe(1000);
    expect(r.finalWip.toNumber()).toBe(3400);
    expect(r.transferredOut.toNumber()).toBe(30000);
    expect(r.totalAccounted.toNumber()).toBe(35000);
    expect(r.totalToAccount.toNumber()).toBe(r.totalAccounted.toNumber());
  });
});

describe('Costeo por Procesos — pérdidas normales y extraordinarias (B08)', () => {
  it('R1: pérdida normal sobre las puestas en elaboración en el depto. inicial (Destilado 600)', () => {
    // Destilado (seq 1), abril: puestas 30.000, % normal 2 % → normal = 600.
    const r = calcNormalAndExtraordinaryLosses({
      sequence: 1,
      startedInProduction: 30000,
      normalLossPct: 0.02,
      totalLossReported: 1600,
    });

    expect(r.periodUnits.toNumber()).toBe(30000);
    expect(r.normalLoss.toNumber()).toBe(600); // 2 % × 30.000
    // Depto. inicial: la normal la absorben las unidades buenas automáticamente.
    expect(r.normalLossAbsorbedAutomatically).toBe(true);
    expect(r.normalLossGeneratesCaup).toBe(false);
  });

  it('R2: pérdida extraordinaria por diferencia en el depto. inicial (Destilado 1.000)', () => {
    // Real total 1.600 − normal 600 = extraordinaria 1.000.
    const r = calcNormalAndExtraordinaryLosses({
      sequence: 1,
      startedInProduction: 30000,
      normalLossPct: 0.02,
      totalLossReported: 1600,
    });

    expect(r.normalLoss.toNumber()).toBe(600);
    expect(r.extraordinaryLoss.toNumber()).toBe(1000); // 1.600 − 600
    expect(r.totalLoss.toNumber()).toBe(1600);
  });

  it('R1: en un depto. posterior la base es "recibidas + aumento" (Purificado 320)', () => {
    // Purificado (seq 2), abril: recibidas 30.000 + aumento 2.000 = base 32.000.
    // % normal 1 % → normal = 320 (el valor que usa el CAUP en B09).
    const r = calcNormalAndExtraordinaryLosses({
      sequence: 2,
      receivedFromPrevious: 30000,
      unitIncrease: 2000,
      normalLossPct: 0.01,
    });

    expect(r.periodUnits.toNumber()).toBe(32000); // 30.000 + 2.000
    expect(r.normalLoss.toNumber()).toBe(320); // 1 % × 32.000
    expect(r.normalLoss.toNumber()).not.toBe(300); // 1 % × 30.000 (sin el aumento)
    // Depto. posterior: la normal genera el CAUP/CAUO (B09).
    expect(r.normalLossAbsorbedAutomatically).toBe(false);
    expect(r.normalLossGeneratesCaup).toBe(true);
  });

  it('R1: la existencia inicial NUNCA entra en la base, aun cuando el cuadro la lleva (Purificado 320)', () => {
    // Prueba fuerte de la regla: mismo Purificado, pero con una EI NO trivial
    // (8.000). Si la base incluyera —erróneamente— la EI, la pérdida normal
    // cambiaría; debe seguir siendo 320 = 1 % × (30.000 + 2.000).
    const conEI = buildUnitMovementSchedule({
      sequence: 2,
      initialWip: 8000, // NO trivial, y NO debe mover la base
      receivedFromPrevious: 30000,
      unitIncrease: 2000,
      transferredOut: 30000,
      normalLossPct: 0.01,
    });
    const sinEI = buildUnitMovementSchedule({
      sequence: 2,
      initialWip: 0,
      receivedFromPrevious: 30000,
      unitIncrease: 2000,
      transferredOut: 30000,
      normalLossPct: 0.01,
    });

    expect(conEI.periodUnits.toNumber()).toBe(32000); // no cambia con la EI
    expect(conEI.normalLoss.toNumber()).toBe(320); // 1 % × 32.000
    // Bases equivocadas que este test descarta:
    expect(conEI.normalLoss.toNumber()).not.toBe(400); // 1 % × (8.000 + 30.000 + 2.000)
    expect(conEI.normalLoss.toNumber()).not.toBe(80); // 1 % × 8.000 (solo la EI)
    // La EI mueve el total a justificar, pero NO la pérdida normal.
    expect(conEI.totalToAccount.toNumber()).not.toBe(sinEI.totalToAccount.toNumber());
    expect(conEI.normalLoss.toNumber()).toBe(sinEI.normalLoss.toNumber());
  });

  it('R2: pérdida real total menor que la normal lanza ProcessValidationError', () => {
    // normal = 2 % × 30.000 = 600; real informada 500 < 600 ⇒ extraordinaria negativa.
    let error: unknown;
    try {
      calcNormalAndExtraordinaryLosses({
        sequence: 1,
        startedInProduction: 30000,
        normalLossPct: 0.02,
        totalLossReported: 500,
      });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ProcessValidationError);
    const err = error as ProcessValidationError;
    expect(err.message).toContain('no puede ser negativa');
    expect((err.details as { normalLoss: number }).normalLoss).toBe(600);
  });

  it('Sin pérdida real total informada ⇒ no hay extraordinaria (default = normal)', () => {
    const r = calcNormalAndExtraordinaryLosses({
      sequence: 1,
      startedInProduction: 30000,
      normalLossPct: 0.02,
    });
    expect(r.normalLoss.toNumber()).toBe(600);
    expect(r.extraordinaryLoss.toNumber()).toBe(0);
    expect(r.totalLoss.toNumber()).toBe(600);
  });

  it('B06 delega en B08: el cuadro y la función pura dan las MISMAS pérdidas (sin regla duplicada)', () => {
    // El cuadro ancla (Destilado) y la función pura deben coincidir célula a
    // célula: es la prueba de que la regla vive en un solo lugar.
    const schedule = buildUnitMovementSchedule({
      sequence: 1,
      initialWip: 5000,
      startedInProduction: 30000,
      transferredOut: 30000,
      finishedInStock: 0,
      normalLossPct: 0.02,
      totalLossReported: 1600,
    });
    const losses = calcNormalAndExtraordinaryLosses({
      sequence: 1,
      startedInProduction: 30000,
      normalLossPct: 0.02,
      totalLossReported: 1600,
    });

    expect(schedule.periodUnits.toNumber()).toBe(losses.periodUnits.toNumber());
    expect(schedule.normalLoss.toNumber()).toBe(losses.normalLoss.toNumber());
    expect(schedule.extraordinaryLoss.toNumber()).toBe(losses.extraordinaryLoss.toNumber());
  });
});

describe('Costeo por Procesos — producción equivalente (B07)', () => {
  /** Atajo: PE de una columna por su elemento. */
  const pe = (schedule: ReturnType<typeof calcEquivalentProduction>, element: EquivalentProductionElement) =>
    schedule.columns.find((c) => c.element === element)?.equivalentUnits.toNumber();

  /** El cuadro ancla ya resuelto (Azur Alcoholes, Destilado, abril). */
  const azurSchedule = (): UnitMovementSchedule =>
    buildUnitMovementSchedule({
      sequence: 1,
      initialWip: 5000,
      startedInProduction: 30000,
      transferredOut: 30000,
      finishedInStock: 0,
      normalLossPct: 0.02, // 600 normal
      totalLossReported: 1600, // 600 normal + 1000 extraordinaria
      // finalWip se deriva por diferencia = 3400
    });

  it('Caso ancla — Azur Alcoholes, Destilado, abril → MP 34.400 / CC 33.720', () => {
    const schedule = azurSchedule();
    // MP al 100 %, CC (conversión) al 80 %.
    const r = calcEquivalentProduction({
      schedule,
      conversionUnified: true,
      conversionAvance: 0.8,
    });

    // Terminadas 30.000 + extraordinarias 1.000 = 31.000 al 100 %.
    expect(r.unitsAtFullCompletion.toNumber()).toBe(31000);
    // MP = 30.000 + 1.000 + (3.400 × 100 %) = 34.400
    expect(pe(r, 'MP')).toBe(34400);
    // CC = 30.000 + 1.000 + (3.400 × 80 %) = 33.720
    expect(pe(r, 'CC')).toBe(33720);
    // Dos columnas cuando la conversión va unificada.
    expect(r.columns.map((c) => c.element)).toEqual(['MP', 'CC']);
  });

  it('R2: las pérdidas extraordinarias entran al 100 % (sacarlas cambiaría el resultado)', () => {
    const schedule = azurSchedule(); // EF 3.400, extraordinarias 1.000
    expect(schedule.extraordinaryLoss.toNumber()).toBe(1000);

    const r = calcEquivalentProduction({ schedule, conversionUnified: true, conversionAvance: 0.8 });

    // Las extraordinarias forman parte de las unidades al 100 %.
    expect(r.unitsAtFullCompletion.toNumber()).toBe(31000); // 30.000 term. + 1.000 extra.
    // CC real = 30.000 + 1.000 + 3.400×0.8 = 33.720.
    // Si (erróneamente) NO se contaran las extraordinarias: 30.000 + 3.400×0.8 = 32.720.
    expect(pe(r, 'CC')).toBe(33720);
    expect(pe(r, 'CC')).not.toBe(32720);
    // El delta es exactamente las 1.000 extraordinarias al 100 %.
    expect((pe(r, 'CC') as number) - 32720).toBe(1000);
  });

  it('R1: las pérdidas normales NO entran (contarlas cambiaría el resultado)', () => {
    // Cuadro con pérdida normal grande (1.000) y sin extraordinaria; EF = 0 para
    // aislar el efecto: la PE debe ser exactamente las terminadas, sin las normales.
    const schedule = buildUnitMovementSchedule({
      sequence: 1,
      initialWip: 0,
      startedInProduction: 10000,
      transferredOut: 9000,
      finishedInStock: 0,
      normalLossPct: 0.1, // 1.000 normal
      totalLossReported: 1000, // sin extraordinaria
      finalWip: 0,
    });
    expect(schedule.normalLoss.toNumber()).toBe(1000);
    expect(schedule.finalWip.toNumber()).toBe(0);

    const r = calcEquivalentProduction({ schedule, conversionUnified: true, conversionAvance: 1 });
    // PE = solo las 9.000 terminadas. Si se sumaran las 1.000 normales daría 10.000.
    expect(pe(r, 'MP')).toBe(9000);
    expect(pe(r, 'CC')).toBe(9000);
    expect(pe(r, 'MP')).not.toBe(10000);
  });

  it('R3: la MP va al 100 % por default en la EF', () => {
    const schedule = azurSchedule();
    // Sin mpAvance: default 100 % ⇒ MP = 31.000 + 3.400 = 34.400.
    const r = calcEquivalentProduction({ schedule, conversionUnified: true, conversionAvance: 0.8 });
    expect(r.columns.find((c) => c.element === 'MP')?.finalWipAvance.toNumber()).toBe(1);
    expect(pe(r, 'MP')).toBe(34400);
  });

  it('R3: el avance de MP se puede sobrescribir', () => {
    const schedule = azurSchedule();
    // MP al 50 %: MP = 30.000 + 1.000 + 3.400×0.5 = 32.700.
    const r = calcEquivalentProduction({ schedule, mpAvance: 0.5, conversionUnified: true, conversionAvance: 0.8 });
    expect(r.columns.find((c) => c.element === 'MP')?.finalWipAvance.toNumber()).toBe(0.5);
    expect(pe(r, 'MP')).toBe(32700);
  });

  it('Tres elementos con avances distintos ⇒ tres columnas separadas', () => {
    const schedule = azurSchedule(); // 31.000 al 100 %, EF 3.400
    const r = calcEquivalentProduction({
      schedule,
      mpAvance: 1, // MP 100 %
      conversionUnified: false,
      modAvance: 0.75, // MOD 75 %
      cipAvance: 0.4, // CIP 40 %
    });

    expect(r.columns.map((c) => c.element)).toEqual(['MP', 'MOD', 'CIP']);
    expect(pe(r, 'MP')).toBe(34400); // 31.000 + 3.400×1
    expect(pe(r, 'MOD')).toBe(31000 + 3400 * 0.75); // 33.550
    expect(pe(r, 'CIP')).toBe(31000 + 3400 * 0.4); // 32.360
    // Las tres columnas son distintas.
    expect(new Set([pe(r, 'MP'), pe(r, 'MOD'), pe(r, 'CIP')]).size).toBe(3);
  });

  it('Un grado de avance fuera de [0, 1] (porcentaje sin normalizar) lanza ProcessValidationError', () => {
    const schedule = azurSchedule();
    expect(() =>
      calcEquivalentProduction({ schedule, conversionUnified: true, conversionAvance: 80 }),
    ).toThrow(ProcessValidationError);
  });
});

describe('Costeo por Procesos — costo transferido = costo modificado + CAUP (B09)', () => {
  // La matriz de 4 combinaciones (aumento × pérdidas normales): UN test por celda,
  // más el caso ancla (que es la celda Sí/Sí) y el control de dilución.

  it('Combo (aumento Sí, normales No): solo costo modificado, y DILUYE bajo el costo previo', () => {
    // Sin EI, con aumento: el mismo costo del período se reparte en más unidades
    // (recibidas + aumento) ⇒ el costo modificado cae por debajo del previo.
    const r = calcTransferredCost({
      sequence: 2,
      previousUnitCost: 3.75,
      previousPeriodTransferredCost: 112500, // 30.000 × 3,75
      receivedUnits: 30000,
      unitIncrease: 2000, // aumento
      // normalLossUnits 0 ⇒ sin CAUP
    });

    // 112.500 ÷ (30.000 + 2.000) = 3,515625 < 3,75 (dilución).
    expect(r.costoModificado.toNumber()).toBe(3.515625);
    expect(r.costoModificado.lt(3.75)).toBe(true); // control de dilución OK
    expect(r.caup.toNumber()).toBe(0);
    expect(r.costoTransferido.toNumber()).toBe(3.515625); // = modificado (CAUP 0)
    expect(r.step1Applied).toBe(true);
    expect(r.step2Applied).toBe(false);
  });

  it('Combo (aumento No, normales Sí): costo modificado por PROMEDIO con EI + CAUP', () => {
    // Con EI y sin aumento: el Paso 1 promedia (EI + período) ÷ (EI + recibidas).
    // Luego el CAUP reparte la pérdida normal entre las unidades buenas.
    const r = calcTransferredCost({
      sequence: 2,
      previousUnitCost: 4.2,
      initialWipTransferredCost: 8000,
      initialWipUnits: 2000,
      previousPeriodTransferredCost: 80000,
      receivedUnits: 20000,
      // unitIncrease 0
      normalLossUnits: 2000,
    });

    // (8.000 + 80.000) ÷ (2.000 + 20.000) = 88.000 ÷ 22.000 = 4,00.
    expect(r.costoModificado.toNumber()).toBe(4);
    // unidades buenas = 22.000 − 2.000 = 20.000; costo de la pérdida = 2.000 × 4 = 8.000.
    expect(r.unidadesBuenas.toNumber()).toBe(20000);
    expect(r.costoDeLaPerdida.toNumber()).toBe(8000);
    // CAUP = 8.000 ÷ 20.000 = 0,40.
    expect(r.caup.toNumber()).toBe(0.4);
    expect(r.costoTransferido.toNumber()).toBe(4.4); // 4,00 + 0,40
    expect(r.step1Applied).toBe(true);
    expect(r.step2Applied).toBe(true);
  });

  it('Combo (aumento Sí, normales Sí) — CASO ANCLA Azur Alcoholes, Purificado, abril → 3,50 / 0,032 / 3,532', () => {
    // Paso 1 y Paso 2, EN ESE ORDEN. Reproduce el caso de cátedra célula a célula.
    const r = calcTransferredCost({
      sequence: 2,
      previousUnitCost: 3.75, // costo unitario previo del Destilado
      initialWipTransferredCost: 11120, // costo total EI del anterior
      initialWipUnits: 3320, // 35.320 a justificar − 30.000 recibidas − 2.000 aumento
      previousPeriodTransferredCost: 112500, // costo del anterior del período
      receivedUnits: 30000,
      unitIncrease: 2000,
      normalLossUnits: 320,
    });

    // Paso 1: (11.120 + 112.500) ÷ 35.320 = 123.620 ÷ 35.320 = 3,50 (< 3,75 previo ✓).
    expect(r.unidadesAJustificar.toNumber()).toBe(35320);
    expect(r.costoModificado.toNumber()).toBe(3.5);
    // Paso 2: unidades buenas 35.320 − 320 = 35.000; costo pérdida 320 × 3,50 = 1.120.
    expect(r.unidadesBuenas.toNumber()).toBe(35000);
    expect(r.costoDeLaPerdida.toNumber()).toBe(1120);
    // CAUP = 1.120 ÷ 35.000 = 0,032.
    expect(r.caup.toNumber()).toBe(0.032);
    // Costo transferido = 3,50 + 0,032 = 3,532.
    expect(r.costoTransferido.toNumber()).toBe(3.532);
    expect(r.step1Applied).toBe(true);
    expect(r.step2Applied).toBe(true);
  });

  it('Combo (aumento No, normales No): devuelve el costo unitario previo SIN cambios', () => {
    // Sin EI, sin aumento y sin pérdidas normales: el costo previo se usa DIRECTO.
    // El costo/unidades del período son inconsistentes con el previo a propósito
    // (100.000 ÷ 30.000 = 3,333) para probar que NO se recalcula: se toma el 3,75.
    const r = calcTransferredCost({
      sequence: 2,
      previousUnitCost: 3.75,
      previousPeriodTransferredCost: 100000,
      receivedUnits: 30000,
      // sin EI, sin aumento, sin pérdidas normales
    });

    expect(r.costoModificado.toNumber()).toBe(3.75); // el previo, directo
    expect(r.costoModificado.toNumber()).not.toBe(100000 / 30000); // NO se recalculó
    expect(r.caup.toNumber()).toBe(0);
    expect(r.costoTransferido.toNumber()).toBe(3.75);
    expect(r.step1Applied).toBe(false);
    expect(r.step2Applied).toBe(false);
  });

  it('Control de cátedra: con aumento, si el costo modificado NO diluye (≥ previo) ⇒ ProcessValidationError', () => {
    // Aumento presente pero la EI arrastra un costo tan alto que el modificado sale
    // por encima del previo: es un error de carga y se corta con un 422 accionable.
    let error: unknown;
    try {
      calcTransferredCost({
        sequence: 2,
        previousUnitCost: 3.0,
        initialWipTransferredCost: 50000, // EI carísima
        initialWipUnits: 2000,
        previousPeriodTransferredCost: 30000,
        receivedUnits: 10000,
        unitIncrease: 1000, // hay aumento ⇒ debería diluir, pero (50.000+30.000)/13.000 = 6,15 > 3
      });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ProcessValidationError);
    const err = error as ProcessValidationError;
    expect(err.message).toContain('ESTRICTAMENTE MENOR');
    expect((err.details as { previousUnitCost: number }).previousUnitCost).toBe(3);
  });
});
