import { describe, it, expect } from 'vitest';
import { runCalculation, type CalculationInput } from '@/domain/calculations/calculate.js';

/**
 * #92 (L3) — El motor no podía contabilizar desperdicio.
 *
 * `desperdicio.ts` implementaba la regla R5 desde hacía tiempo, con 181 líneas
 * de tests en verde, y **su único importador era su propio archivo de test**.
 * El andamiaje estaba entero y desconectado: tabla, módulo y tests, sin nadie
 * que los llamara.
 *
 * R5 (cátedra, clase 4):
 *
 *   > El desperdicio NORMAL neto de recupero lo absorben las unidades buenas.
 *   > El desperdicio EXTRAORDINARIO es pérdida del período — nunca costo.
 *
 * CÓMO SE CABLEÓ, Y POR QUÉ ASÍ (el punto que hay que revisar):
 *
 * La merma normal **no se suma** al costo. Ya está adentro: la materia prima
 * desperdiciada salió del almacén y la ficha de stock la registró como consumo.
 * Sumarla otra vez sería contarla dos veces. La cátedra la trabaja por cantidad
 * BRUTA justamente por eso —se compran 400 g para usar 380—, y el motor de
 * Procesos hace lo mismo (`normalLossAbsorbedAutomatically`).
 *
 * Lo que sí mueve el costo son los otros dos renglones, y los dos RESTAN:
 *
 *   · el RECUPERO, porque «se contabiliza como reducción del costo de
 *     materiales, no como ingreso separado» (clase 4);
 *   · la merma EXTRAORDINARIA, porque nunca es costo: su valor ya está adentro
 *     del costo de producción y hay que sacarlo para llevarlo al resultado.
 */
describe('#92 — el desperdicio entra al motor con la regla R5', () => {
  /** 100 unidades de MP a $1.000 = $100.000 de costo de producción, sin MOD ni CIP. */
  function caso(desperdicios?: CalculationInput['desperdicios']): CalculationInput {
    return {
      rawMaterial: {
        materials: [
          {
            name: 'Insumo', code: 'MP-01', unit: 'u',
            wilson: { annualDemand: 1200, orderCost: 1000, holdingRate: 0.2, unitCost: 100 },
            stockPolicy: { minConsumption: 1, maxConsumption: 2, minLeadTime: 1, maxLeadTime: 2, safetyStock: 0 },
            initialStock: { quantity: 0, unitCost: 0 },
            movements: [
              { date: '01/01/2026', type: 'purchase', detail: 'Compra', quantity: 100, unitCost: 1000 },
              { date: '20/01/2026', type: 'consumption', detail: 'Consumo', quantity: 100 },
            ],
          },
        ],
      },
      directLabor: {
        workingDays: {
          totalDaysPerYear: 365,
          unpaidAbsence: { sundays: 52, saturdays: 52, unjustifiedAbsences: 0, holidaysOnWeekend: 0 },
          paidAbsence: { holidays: 15, vacations: 14, sickness: 0, specialLeaves: 0, workAccidents: 0 },
        },
        itcs: { derivationBase: 0, fixedArt: 0, uncertainRemunerative: [], uncertainNonRemunerative: [] },
        departments: [{ name: 'Único', basicRemuneration: 0, hoursWorked: 100 }],
      },
      indirectCosts: {
        centers: [{ id: 'unico', name: 'Único', type: 'productive' }],
        concepts: [{ name: 'CIF', amount: { fixed: 0, variable: 0 }, distribution: { unico: 1 } }],
        serviceDistributions: [],
        productiveSettings: [
          { centerId: 'unico', normalCapacity: 100, actualActivity: 100, actualCip: 0 },
        ] as CalculationInput['indirectCosts']['productiveSettings'],
      },
      ...(desperdicios ? { desperdicios } : {}),
      inventory: { initialWorkInProcess: 0, finalWorkInProcess: 0, initialFinishedGoods: 0, finalFinishedGoods: 0 },
      sales: { unitPrice: 2000, quantity: 100, productionQuantity: 100 },
    };
  }

  const SIN_DESPERDICIO = 100000;

  it('criterio 4: un período con desperdicio declarado da un costo unitario distinto', () => {
    const sin = runCalculation(caso());
    const con = runCalculation(
      caso([{ concepto: 'Producto arruinado por corte de luz', valor: 20000, naturaleza: 'extraordinaria' }]),
    );

    expect(sin.detail.unitCost.unitProductionCost).toBeCloseTo(1000, 6);
    expect(con.detail.unitCost.unitProductionCost).toBeCloseTo(1000, 6);
    // El costo unitario de lo TERMINADO sí cambia: la merma extraordinaria salió.
    expect(sin.detail.unitCost.unitFinishedGoodsCost).toBeCloseTo(1000, 6);
    expect(con.detail.unitCost.unitFinishedGoodsCost).toBeCloseTo(800, 6);
    expect(con.detail.unitCost.unitFinishedGoodsCost).not.toBeCloseTo(
      sin.detail.unitCost.unitFinishedGoodsCost,
      6,
    );
  });

  it('la merma EXTRAORDINARIA sale del costo y se informa como pérdida del período', () => {
    const r = runCalculation(
      caso([{ concepto: 'Mortandad por golpe de calor', valor: 20000, naturaleza: 'extraordinaria' }]),
    );

    expect(r.desperdicio!.alResultado).toBe(20000);
    expect(r.desperdicio!.alCosto).toBe(0);
    // 100.000 − 20.000 = 80.000 llegan al costo de lo vendido.
    expect(r.costOfGoodsSold).toBeCloseTo(SIN_DESPERDICIO - 20000, 2);
    // El costo NORMAL de producción no se toca: la pérdida se resta después.
    expect(r.productionCost).toBeCloseTo(SIN_DESPERDICIO, 2);
  });

  it('la merma NORMAL no se suma: ya está adentro del costo (no se cuenta dos veces)', () => {
    const sin = runCalculation(caso());
    const con = runCalculation(
      caso([{ concepto: 'Merma de proceso habitual', valor: 15000, naturaleza: 'normal' }]),
    );

    // Se informa cuánto absorbieron las unidades buenas...
    expect(con.desperdicio!.alCosto).toBe(15000);
    // ...pero el costo NO cambia: esa merma ya estaba en la MP consumida.
    expect(con.costOfGoodsSold).toBeCloseTo(sin.costOfGoodsSold, 6);
  });

  it('el RECUPERO de la merma normal reduce el costo de materiales (clase 4)', () => {
    const r = runCalculation(
      caso([
        { concepto: 'Recortes vendidos como chatarra', valor: 15000, naturaleza: 'normal', valorRecupero: 5000 },
      ]),
    );

    expect(r.desperdicio!.recuperoAplicado).toBe(5000);
    // La merma normal neta de recupero: 15.000 − 5.000.
    expect(r.desperdicio!.alCosto).toBe(10000);
    // Y el costo baja exactamente en el recupero, no en la merma entera.
    expect(r.costOfGoodsSold).toBeCloseTo(SIN_DESPERDICIO - 5000, 2);
  });

  it('🚨 un registro SIN naturaleza declarada no entra al cálculo y queda pendiente', () => {
    const r = runCalculation(
      caso([{ concepto: 'Huevo roto', valor: 30000, naturaleza: null }]),
    );

    // Ni al costo ni al resultado: el sistema no elige el criterio que nadie dio.
    expect(r.desperdicio!.alCosto).toBe(0);
    expect(r.desperdicio!.alResultado).toBe(0);
    expect(r.costOfGoodsSold).toBeCloseTo(SIN_DESPERDICIO, 2);
    // Pero se ve, con el motivo escrito.
    expect(r.desperdicio!.pendientes).toHaveLength(1);
    expect(r.desperdicio!.pendientes[0]!.concepto).toBe('Huevo roto');
    expect(r.desperdicio!.pendientes[0]!.motivo).toContain('no lo elige por vos');
  });

  it('una mezcla real de un mes: cada renglón a su lugar', () => {
    const r = runCalculation(
      caso([
        { concepto: 'Merma de proceso', valor: 15000, naturaleza: 'normal', valorRecupero: 5000 },
        { concepto: 'Rotura por corte de luz', valor: 20000, naturaleza: 'extraordinaria' },
        { concepto: 'Faltante de inventario', valor: 8000, naturaleza: null },
      ]),
    );

    expect(r.desperdicio!.alCosto).toBe(10000);
    expect(r.desperdicio!.alResultado).toBe(20000);
    expect(r.desperdicio!.recuperoAplicado).toBe(5000);
    expect(r.desperdicio!.pendientes).toHaveLength(1);
    // Del costo salieron el recupero (5.000) y la extraordinaria (20.000).
    expect(r.costOfGoodsSold).toBeCloseTo(SIN_DESPERDICIO - 25000, 2);
  });

  it('sin desperdicios declarados, ningún número cambia respecto de antes', () => {
    const sinCampo = runCalculation(caso());
    const listaVacia = runCalculation(caso([]));

    expect(sinCampo.costOfGoodsSold).toBe(listaVacia.costOfGoodsSold);
    expect(sinCampo.productionCost).toBeCloseTo(SIN_DESPERDICIO, 2);
    expect(sinCampo.desperdicio!.alCosto).toBe(0);
    expect(sinCampo.desperdicio!.alResultado).toBe(0);
    expect(sinCampo.desperdicio!.pendientes).toEqual([]);
  });

  it('criterio 3: las dos cifras se exponen por separado, no mezcladas', () => {
    const r = runCalculation(
      caso([
        { concepto: 'Merma de proceso', valor: 15000, naturaleza: 'normal' },
        { concepto: 'Rotura', valor: 20000, naturaleza: 'extraordinaria' },
      ]),
    );

    // Una es costo del producto y la otra es pérdida de la empresa. Un solo
    // número de "desperdicio total" escondería justamente lo que hay que ver.
    expect(r.desperdicio!.alCosto).toBe(15000);
    expect(r.desperdicio!.alResultado).toBe(20000);
    expect(r.desperdicio!.alCosto).not.toBe(r.desperdicio!.alResultado);
  });
});
