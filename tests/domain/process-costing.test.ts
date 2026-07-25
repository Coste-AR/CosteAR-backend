import { describe, it, expect } from 'vitest';
import {
  buildUnitMovementSchedule,
  calcEquivalentProduction,
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
