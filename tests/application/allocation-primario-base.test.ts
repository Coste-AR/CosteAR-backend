import { describe, it, expect } from 'vitest';
import {
  applyPrimaryAllocationBases,
  computeProductiveBudgets,
} from '@/domain/calculations/calculate.js';
import { indirectCostConfigSchema } from '@/shared/schemas/cost.schema.js';

/**
 * E1 · Paso 1 — el motor DERIVA el prorrateo PRIMARIO desde una base de
 * asignación cuando el concepto está en modo 'base'. Los porcentajes no se
 * tipean ni los inventa la IA: salen de las unidades (unidad ÷ Σ unidades). Los
 * modos 'percent'/'direct' quedan intactos (cero regresión).
 */
describe('E1 — prorrateo primario derivado de una base de asignación', () => {
  it('deriva 60/40 desde superficie 60/40 m² y reparte los pesos al centavo', () => {
    const config = indirectCostConfigSchema.parse({
      centers: [
        { id: 'corte', name: 'Corte', type: 'productive' },
        { id: 'armado', name: 'Armado', type: 'productive' },
      ],
      // Concepto en modo 'base': NO trae distribution tipeada; la deriva la base.
      concepts: [
        {
          name: 'Alquiler',
          amount: { fixed: 1000, variable: 500 },
          distribution: {},
          allocationMode: 'base',
          baseCode: 'SUP',
        },
      ],
      serviceDistributions: [],
      productiveSettings: [],
    });

    // Antes de resolver la base, la distribución está vacía.
    expect(config.concepts[0]!.distribution).toEqual({});

    // Base "SUP" (superficie en m²): 60 en Corte, 40 en Armado.
    const resolved = applyPrimaryAllocationBases(config, (code) =>
      code === 'SUP' ? { corte: 60, armado: 40 } : undefined,
    );

    // Las unidades se volcaron a distribution → el motor deriva los %.
    expect(resolved.concepts[0]!.distribution).toEqual({ corte: 60, armado: 40 });

    const budgets = computeProductiveBudgets(resolved);
    // 60/100 = 60% → Corte 600 f / 300 v ; 40/100 = 40% → Armado 400 f / 200 v.
    expect(budgets.corte).toEqual({ fixed: 600, variable: 300 });
    expect(budgets.armado).toEqual({ fixed: 400, variable: 200 });
    // No se pierde ni un centavo.
    expect(budgets.corte!.fixed + budgets.armado!.fixed).toBeCloseTo(1000, 2);
    expect(budgets.corte!.variable + budgets.armado!.variable).toBeCloseTo(500, 2);
  });

  it('modo porcentaje (default) queda EXACTAMENTE igual (cero regresión)', () => {
    const config = indirectCostConfigSchema.parse({
      centers: [
        { id: 'corte', name: 'Corte', type: 'productive' },
        { id: 'armado', name: 'Armado', type: 'productive' },
      ],
      // Sin allocationMode → default 'percent': % tipeados a mano.
      concepts: [
        { name: 'Energía', amount: { fixed: 1000, variable: 500 }, distribution: { corte: 70, armado: 30 } },
      ],
      serviceDistributions: [],
      productiveSettings: [],
    });

    // Aunque exista un resolvedor, un concepto que NO está en modo 'base' no se toca.
    const resolved = applyPrimaryAllocationBases(config, () => ({ corte: 1, armado: 1 }));
    expect(resolved.concepts).toEqual(config.concepts);

    const budgets = computeProductiveBudgets(resolved);
    expect(budgets.corte).toEqual({ fixed: 700, variable: 350 });
    expect(budgets.armado).toEqual({ fixed: 300, variable: 150 });
  });

  it('ignora centros inexistentes y ceros; base sin valores no toca nada', () => {
    const config = indirectCostConfigSchema.parse({
      centers: [
        { id: 'corte', name: 'Corte', type: 'productive' },
        { id: 'armado', name: 'Armado', type: 'productive' },
      ],
      concepts: [
        { name: 'Seguro', amount: { fixed: 900, variable: 0 }, distribution: {}, allocationMode: 'base', baseCode: 'SUP' },
      ],
      serviceDistributions: [],
      productiveSettings: [],
    });

    const resolved = applyPrimaryAllocationBases(config, () => ({
      fantasma: 500, // no existe → se ignora
      corte: 60,
      armado: 0, // 0 no suma a la base → se ignora
    }));
    expect(resolved.concepts[0]!.distribution).toEqual({ corte: 60 });

    // Base sin valores (resolvedor → undefined) deja el concepto como estaba.
    const untouched = applyPrimaryAllocationBases(config, () => undefined);
    expect(untouched.concepts[0]!.distribution).toEqual({});
  });
});
