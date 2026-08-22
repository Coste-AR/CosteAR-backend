import { describe, it, expect } from 'vitest';
import { freezeProcessPeriod } from '@/domain/calculations/freeze-process-period.js';

/**
 * Congelar un período de Costeo por Procesos con la misma forma que Órdenes.
 *
 * Lo que se prueba acá no es el motor —eso ya tiene sus tests— sino la
 * TRADUCCIÓN: que los tres elementos del costo salgan de donde tienen que salir
 * y que el costo de producción no cuente dos veces el mismo peso.
 */

const molienda = {
  name: 'Molienda',
  sequence: 1,
  periodCostMp: 100_000,
  periodCostMo: 40_000,
  periodCostCif: 20_000,
  costoTerminadasYTransferidas: 128_000,
  costoTerminadasEnStock: 0,
  costoUnitarioTotalAcumulado: 160,
};

const destilado = {
  name: 'Destilado',
  sequence: 2,
  periodCostMp: 0,
  periodCostMo: 30_000,
  periodCostCif: 10_000,
  costoTerminadasYTransferidas: 154_000,
  costoTerminadasEnStock: 22_000,
  costoUnitarioTotalAcumulado: 220,
};

const base = {
  departments: [molienda, destilado],
  salesUnitPrice: 300,
  salesQuantity: 700,
  productionQuantity: 800,
};

describe('Los tres elementos del costo', () => {
  it('suman lo incurrido en el período por TODOS los departamentos', () => {
    const f = freezeProcessPeriod(base);

    expect(f.rawMaterialConsumed).toBe(100_000);
    expect(f.directLaborTotal).toBe(70_000); // 40.000 + 30.000
    expect(f.indirectCostsApplied).toBe(30_000); // 20.000 + 10.000
  });

  it('un departamento sin MP propia no rompe la suma', () => {
    // Destilado recibe la MP ya incorporada del anterior: su periodCostMp es 0.
    const f = freezeProcessPeriod({ ...base, departments: [destilado] });
    expect(f.rawMaterialConsumed).toBe(0);
  });
});

describe('Costo de producción', () => {
  it('es lo que TERMINÓ el último departamento, no la suma de todos', () => {
    const f = freezeProcessPeriod(base);

    // 154.000 transferidas + 22.000 en stock = 176.000.
    expect(f.productionCost).toBe(176_000);

    // Si se sumaran los departamentos daría 304.000: contaría dos veces el costo
    // que Molienda ya le transfirió a Destilado. Ese es el error clásico.
    expect(f.productionCost).not.toBe(
      molienda.costoTerminadasYTransferidas + destilado.costoTerminadasYTransferidas + destilado.costoTerminadasEnStock,
    );
  });

  it('el orden de los departamentos no depende de cómo vengan en la lista', () => {
    const alReves = freezeProcessPeriod({ ...base, departments: [destilado, molienda] });
    const derecho = freezeProcessPeriod(base);

    // "El último departamento" es el de mayor secuencia, no el último del array.
    expect(alReves.productionCost).toBe(derecho.productionCost);
  });

  it('sin departamentos no explota (aunque el número no signifique nada)', () => {
    const f = freezeProcessPeriod({ ...base, departments: [] });

    expect(f.productionCost).toBe(0);
    // Sin costo, el margen da 100%. Es aritméticamente correcto y no tiene
    // sentido de negocio: una estructura sin departamentos no debería llegar
    // hasta acá. Esa barrera es del setup previo, no de esta función — lo que se
    // fija acá es que no devuelva NaN ni Infinity.
    expect(Number.isFinite(f.grossMarginPct)).toBe(true);
    expect(f.costOfGoodsSold).toBe(0);
  });
});

describe('Venta y margen', () => {
  it('el CMV usa el costo unitario del último departamento por lo vendido', () => {
    const f = freezeProcessPeriod(base);

    expect(f.costOfGoodsSold).toBe(220 * 700); // 154.000
    expect(f.grossMargin).toBe(300 * 700 - 220 * 700); // 56.000
    expect(f.grossMarginPct).toBeCloseTo((56_000 / 210_000) * 100, 6);
  });

  it('sin ventas el margen es 0, no NaN ni Infinity', () => {
    const f = freezeProcessPeriod({ ...base, salesUnitPrice: 0, salesQuantity: 0 });

    expect(f.grossMarginPct).toBe(0);
    expect(Number.isFinite(f.grossMarginPct)).toBe(true);
    expect(Number.isFinite(f.detail.unitCost.unitProductionCost)).toBe(true);
  });
});

describe('Costo unitario', () => {
  it('divide por las unidades PRODUCIDAS, no por las vendidas', () => {
    const f = freezeProcessPeriod(base);

    // 176.000 ÷ 800 producidas = 220. Dividir por 700 vendidas daría 251,43:
    // un costo unitario inflado.
    expect(f.detail.unitCost.unitsProduced).toBe(800);
    expect(f.detail.unitCost.unitProductionCost).toBe(220);
  });

  it('el CPV unitario divide por las VENDIDAS, y da el mismo costo por unidad (#88)', () => {
    const f = freezeProcessPeriod(base);

    // `costOfGoodsSold` es 220 × 700 vendidas. Dividirlo por las 800 producidas
    // daba 192,50: el costo unitario escalado por la proporción de venta, que no
    // es el costo de nada. Una unidad no cambia de costo por haberse vendido.
    expect(f.detail.unitCost.unitCostOfGoodsSold).toBe(220);
  });

  it('sin productionQuantity (Procesos nunca lo carga) deriva las unidades del último departamento, no de las vendidas (H11)', () => {
    const f = freezeProcessPeriod({ ...base, productionQuantity: null });

    // 176.000 (productionCost) ÷ 220 (finalUnitCost) = 800: las mismas 800
    // unidades producidas que da el caso con productionQuantity cargado. Caer a
    // las 700 vendidas —el criterio de Órdenes— infla el costo unitario y es
    // exactamente el bug que H11 encontró en un período cerrado real.
    expect(f.detail.unitCost.unitsProduced).toBe(800);
    expect(f.detail.unitCost.unitProductionCost).toBe(220);
  });

  it('sin departamentos ni costo (finalUnitCost 0) cae a las vendidas para no dividir por cero', () => {
    const f = freezeProcessPeriod({ ...base, departments: [], productionQuantity: null });
    expect(f.detail.unitCost.unitsProduced).toBe(700);
  });
});

describe('Detalle para el drill-down de la comparación', () => {
  it('conserva el desglose por departamento, que en Procesos sí existe', () => {
    const f = freezeProcessPeriod(base);

    expect(f.detail.directLabor.departments.map((d) => d.name)).toEqual(['Molienda', 'Destilado']);
    expect(f.detail.directLabor.departments[1]!.totalMod).toBe(30_000);
    expect(f.detail.indirectCosts.perDepartment['Destilado']!.cipTotal).toBe(10_000);
  });

  it('deja vacío el detalle por materia prima en vez de inventarlo', () => {
    const f = freezeProcessPeriod(base);

    // En Procesos la MP se registra por departamento, no abierta por material.
    // Ese detalle no existe en el sistema: fabricarlo sería mentir.
    expect(f.detail.rawMaterial.materials).toEqual([]);
  });
});
