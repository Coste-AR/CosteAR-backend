import { describe, it, expect } from 'vitest';
import { computeProductiveBudgets } from '@/application/cost-structures/calculate.js';
import { indirectCostConfigSchema } from '@/shared/schemas/cost.schema.js';

/**
 * Wiring de la Parte 4: la config con `closureOrder` activa el prorrateo
 * ESCALONADO y el presupuesto productivo se DERIVA (nunca se tipea). Sin
 * `closureOrder`, se mantiene la pasada directa (retrocompatible: FX1/FX3 y
 * estructuras ya cargadas siguen andando).
 */
describe('Parte 4 — closureOrder activa el escalonado en computeProductiveBudgets', () => {
  it('con orden de cierre reproduce FX4 (servicio→servicio, cerrado no recibe)', () => {
    const config = indirectCostConfigSchema.parse({
      centers: [
        { id: 'oftecnica', name: 'Oficina Técnica', type: 'service' },
        { id: 'mantenimiento', name: 'Mantenimiento', type: 'service' },
        { id: 'corte', name: 'Corte', type: 'productive' },
        { id: 'mecanizado', name: 'Mecanizado', type: 'productive' },
      ],
      // Primario cargado como dos conceptos "direct" que caen en cada servicio.
      concepts: [
        {
          name: 'Costos Of. Técnica',
          amount: { fixed: 653, variable: 120 },
          distribution: { oftecnica: 1 },
        },
        {
          name: 'Costos Mantenimiento',
          amount: { fixed: 2237, variable: 2452 },
          distribution: { mantenimiento: 1 },
        },
      ],
      serviceDistributions: [
        { serviceCenterId: 'oftecnica', toProductive: { mecanizado: 3, mantenimiento: 1 } },
        { serviceCenterId: 'mantenimiento', toProductive: { corte: 225, mecanizado: 525 } },
      ],
      closureOrder: ['oftecnica', 'mantenimiento'],
      productiveSettings: [],
    });

    const budgets = computeProductiveBudgets(config);

    // Σ productivos = Σ primario (2.890 f / 2.572 v): no se pierde nada, los
    // servicios cerraron en 0 (no figuran como productivos).
    expect(budgets.corte!.fixed + budgets.mecanizado!.fixed).toBeCloseTo(2890, 2);
    expect(budgets.corte!.variable + budgets.mecanizado!.variable).toBeCloseTo(2572, 2);
    // Corte solo recibe de Mantenimiento (Of. Técnica fue a Mecanizado):
    // 2.400,25 × 0,3 = 720,075 → 720,08 ; 2.482 × 0,3 = 744,60.
    expect(budgets.corte!.fixed).toBeCloseTo(720.08, 2);
    expect(budgets.corte!.variable).toBeCloseTo(744.6, 2);
    expect(budgets.oftecnica).toBeUndefined();
    expect(budgets.mantenimiento).toBeUndefined();
  });

  it('sin orden de cierre usa la pasada directa (retrocompat)', () => {
    const config = indirectCostConfigSchema.parse({
      centers: [
        { id: 'mantenimiento', name: 'Mantenimiento', type: 'service' },
        { id: 'corte', name: 'Corte', type: 'productive' },
        { id: 'ensamblaje', name: 'Ensamblaje', type: 'productive' },
      ],
      concepts: [
        { name: 'Corte', amount: { fixed: 120000, variable: 100000 }, distribution: { corte: 1 } },
        { name: 'Ensamblaje', amount: { fixed: 120000, variable: 60000 }, distribution: { ensamblaje: 1 } },
        { name: 'Mantenimiento', amount: { fixed: 60000, variable: 140000 }, distribution: { mantenimiento: 1 } },
      ],
      serviceDistributions: [
        { serviceCenterId: 'mantenimiento', toProductive: { corte: 60, ensamblaje: 40 } },
      ],
      productiveSettings: [],
    });

    const budgets = computeProductiveBudgets(config);
    // FX3: Corte 156.000f/184.000v, Ensamblaje 144.000f/116.000v.
    expect(budgets.corte).toEqual({ fixed: 156000, variable: 184000 });
    expect(budgets.ensamblaje).toEqual({ fixed: 144000, variable: 116000 });
  });
});
