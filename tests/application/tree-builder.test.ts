import { describe, it, expect } from 'vitest';
import { runCalculation, type CalculationInput } from '@/domain/calculations/calculate.js';
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
    // T-09: el nodo se rotula con el NOMBRE del centro, no con su id interno.
    const mec = tree[2]!.children.find((c) => c.label === 'Mecanizado');
    expect(mec).toBeDefined();
    expect(mec!.children.map((c) => c.label)).toEqual([
      'Cuota fija',
      'Cuota variable',
      'CIP real',
      'Variación presupuesto',
      'Variación volumen',
    ]);
  });

  // ---------------------------------------------------------------------
  // T-09 — los centros de costo se muestran por su nombre, no por su id
  // ---------------------------------------------------------------------
  describe('T-09 — etiqueta de los centros de costo', () => {
    it('el nodo del centro lleva el nombre configurado, nunca el id crudo', () => {
      const labels = tree[2]!.children.map((c) => c.label);
      expect(labels).toEqual(['Mecanizado', 'Terminado']);
      // Y ningún id interno se filtra a la pantalla.
      expect(labels).not.toContain('mec');
      expect(labels).not.toContain('ter');
    });

    it('cae al id SOLO si el centro no está en la configuración', () => {
      // Centro que quedó en el resultado pero ya no está en `centers[]` (config
      // vieja, o centro borrado de la lista sin borrar su `productiveSetting`).
      // Se arma el árbol con el resultado REAL y una config recortada: el motor
      // no deja calcular ese caso, pero el árbol sí tiene que sobrevivirlo.
      const huerfano: CalculationInput = {
        ...input,
        indirectCosts: {
          ...input.indirectCosts,
          centers: [{ id: 'mec', name: 'Mecanizado', type: 'productive' }],
        },
      };
      const t = buildCalculationTree(huerfano, output);
      expect(t[2]!.children.map((c) => c.label)).toEqual(['Mecanizado', 'ter']);
    });
  });

  // ---------------------------------------------------------------------
  // T-02 — el árbol emite claves determinísticas, no depende de la etiqueta
  // ---------------------------------------------------------------------
  describe('T-02 — claves de trazabilidad del árbol', () => {
    it('"Remuneración básica" lleva la clave de SU departamento', () => {
      const claves = tree[1]!.children
        .filter((c) => c.label === 'Mecanizado' || c.label === 'Terminado')
        .map((d) => d.children.find((c) => c.label === 'Remuneración básica')!.traceFieldKey);
      expect(claves).toEqual([
        'mod.dpto.Mecanizado.remuneracion',
        'mod.dpto.Terminado.remuneracion',
      ]);
    });

    it('"CIP real" lleva la clave de SU centro (por id, que es lo que persiste)', () => {
      const claves = tree[2]!.children.map(
        (c) => c.children.find((x) => x.label === 'CIP real')!.traceFieldKey,
      );
      expect(claves).toEqual(['cip.centro.mec.cipReal', 'cip.centro.ter.cipReal']);
    });

    it('las hojas de venta llevan la fieldKey que emite salesPoints()', () => {
      const ingreso = tree[3]!.children.find((c) => c.label === 'Ingreso')!;
      expect(ingreso.children.map((c) => c.traceFieldKey)).toEqual([
        'venta.precio_unitario',
        'venta.cantidad_vendida',
      ]);
    });

    it('cada movimiento de MP lleva una clave ÚNICA aunque compartan detalle', () => {
      const dosCompras: CalculationInput = {
        ...input,
        rawMaterial: {
          materials: [
            {
              ...input.rawMaterial.materials[0]!,
              movements: [
                { date: '2026-08-05', type: 'purchase', detail: 'Proveedor X', quantity: 100, unitCost: 2600 },
                { date: '2026-08-05', type: 'purchase', detail: 'Proveedor X', quantity: 150, unitCost: 2700 },
              ],
            },
          ],
        },
      };
      const t = buildCalculationTree(dosCompras, runCalculation(dosCompras));
      const movimientos = t[0]!.children.filter((c) => c.label === 'Compra — Proveedor X');
      expect(movimientos).toHaveLength(2);

      const claves = movimientos.map((m) => m.traceFieldKey);
      // Misma etiqueta y misma fecha: lo que las distingue es la ocurrencia, que
      // es exactamente cómo las numera el lado de escritura (T-01).
      expect(claves[0]).toBe('mp.compra.cantidad|Compra — Proveedor X|2026-08-05|cantidad|0');
      expect(claves[1]).toBe('mp.compra.cantidad|Compra — Proveedor X|2026-08-05|cantidad|1');
      expect(new Set(claves).size).toBe(2);
    });

    it('la clave del movimiento NO depende de la etiqueta que muestra el nodo', () => {
      const movimiento = tree[0]!.children.find((c) => c.label === 'Compra — Compra')!;
      const clave = movimiento.traceFieldKey;
      // Renombrar la etiqueta del nodo (lo que hace cualquier cambio de copy) no
      // toca la clave: el enlace al dato sigue siendo el mismo.
      movimiento.label = 'Compra de acero al proveedor';
      expect(movimiento.traceFieldKey).toBe(clave);
    });
  });
});
