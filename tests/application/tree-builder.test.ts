import { describe, it, expect } from 'vitest';
import { runCalculation, type CalculationInput } from '@/application/cost-structures/calculate.js';
import { buildCalculationTree } from '@/application/cost-structures/tree-builder.js';

/**
 * El árbol NUNCA debe divergir del número plano que ya devuelve el motor —
 * lo arma a partir de los mismos objetos (`output.raw`), no recalcula. Estos
 * tests verifican esa igualdad usando el caso "Piezas mecánicas" de R5.
 */
describe('tree-builder — el árbol coincide con los totales del motor', () => {
  const input: CalculationInput = {
    rawMaterial: {
      materials: [
        {
          name: 'Acero', code: 'MP-100', unit: 'u',
          wilson: { annualDemand: 6000, orderCost: 5000, holdingRate: 0.3, unitCost: 1200 },
          stockPolicy: { minConsumption: 20, maxConsumption: 40, minLeadTime: 5, maxLeadTime: 12, safetyStock: 200 },
          initialStock: { quantity: 300, unitCost: 2400 },
          movements: [
            { date: '01', type: 'purchase', detail: 'Compra', quantity: 1000, unitCost: 2600 },
            { date: '02', type: 'consumption', detail: 'Consumo', quantity: 800 },
          ],
        },
      ],
    },
    directLabor: {
      workingDays: {
        totalDaysPerYear: 365,
        unpaidAbsence: { sundays: 52, saturdays: 52, unjustifiedAbsences: 2, holidaysOnWeekend: 3 },
        paidAbsence: { holidays: 12, vacations: 14, sickness: 6, specialLeaves: 2, workAccidents: 6 },
      },
      itcs: {
        derivationBase: 0.27,
        fixedArt: 0.015,
        uncertainRemunerative: [{ name: 'Premio', coefficient: 0.15 }],
        uncertainNonRemunerative: [],
      },
      departments: [
        { name: 'Mecanizado', basicRemuneration: 1500000, hoursWorked: 400 },
        { name: 'Terminado', basicRemuneration: 1200000, hoursWorked: 350 },
      ],
    },
    indirectCosts: {
      centers: [
        { id: 'mec', name: 'Mecanizado', type: 'productive' },
        { id: 'ter', name: 'Terminado', type: 'productive' },
      ],
      concepts: [{ name: 'Costos', amount: { fixed: 600000, variable: 300000 }, distribution: { mec: 60, ter: 40 } }],
      serviceDistributions: [],
      productiveSettings: [
        { centerId: 'mec', normalCapacity: 400, actualActivity: 400, actualCip: 400000 },
        { centerId: 'ter', normalCapacity: 350, actualActivity: 350, actualCip: 400000 },
      ] as CalculationInput['indirectCosts']['productiveSettings'],
    },
    inventory: { initialWorkInProcess: 0, finalWorkInProcess: 0, initialFinishedGoods: 0, finalFinishedGoods: 0 },
    sales: { unitPrice: 13250, quantity: 800 },
  };

  const output = runCalculation(input);
  const tree = buildCalculationTree(input, output);

  it('4 raíces: MP, MOD, CIP, VENTA', () => {
    expect(tree).toHaveLength(4);
    expect(tree.map((n) => n.label)).toEqual([
      'Materia Prima Consumida',
      'Mano de Obra Directa',
      'Costos Indirectos de Producción Aplicados',
      'Venta y Margen',
    ]);
  });

  it('raíz MP == output.rawMaterialConsumed', () => {
    expect(tree[0]!.value).toBe(output.rawMaterialConsumed);
  });

  it('raíz MOD == output.directLaborTotal', () => {
    expect(tree[1]!.value).toBe(output.directLaborTotal);
  });

  it('raíz CIP == output.indirectCostsApplied', () => {
    expect(tree[2]!.value).toBe(output.indirectCostsApplied);
  });

  it('raíz VENTA (margen) == output.grossMargin', () => {
    expect(tree[3]!.value).toBe(output.grossMargin);
  });

  it('hijos de MP incluyen cada movimiento del ledger', () => {
    const mpChildren = tree[0]!.children.map((c) => c.label);
    expect(mpChildren).toContain('Compra — Compra');
    expect(mpChildren).toContain('Consumo — Consumo');
  });

  it('hijos de MOD incluyen ITCS con su descomposición CSC/B40/F40/B47', () => {
    const itcsNode = tree[1]!.children.find((c) => c.label.startsWith('ITCS'));
    expect(itcsNode).toBeDefined();
    expect(itcsNode!.children.map((c) => c.label)).toEqual([
      'Cargas Sociales Ciertas (CSC)',
      'Inciertas remunerativas (B40)',
      'Cargas derivadas (F40)',
      'Inciertas no remunerativas (B47)',
    ]);
  });

  it('hijos de CIP tienen un nodo por centro con cuota, real y variaciones', () => {
    const mec = tree[2]!.children.find((c) => c.label === 'mec');
    expect(mec).toBeDefined();
    expect(mec!.children.map((c) => c.label)).toEqual([
      'Cuota fija',
      'Cuota variable',
      'CIP real',
      'Variación presupuesto',
      'Variación volumen',
    ]);
  });
});
