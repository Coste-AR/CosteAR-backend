import { describe, it, expect } from 'vitest';
import {
  applySecondaryAllocationBases,
  computeProductiveBudgets,
} from '@/domain/calculations/calculate.js';
import { indirectCostConfigSchema } from '@/shared/schemas/cost.schema.js';

/**
 * Paso 1 (E2) — el motor DERIVA el reparto secundario desde una base de
 * asignación cuando el servicio está en modo 'base'. Los porcentajes no se
 * tipean: salen de las unidades de la base (unidad ÷ Σ unidades). El modo
 * 'manual' queda intacto (cero regresión).
 */
describe('E2 — reparto secundario derivado de una base de asignación', () => {
  it('deriva 60/40 desde horas-máquina 300/200 y reparte los pesos al centavo', () => {
    const config = indirectCostConfigSchema.parse({
      centers: [
        { id: 'mantenimiento', name: 'Mantenimiento', type: 'service' },
        { id: 'corte', name: 'Corte', type: 'productive' },
        { id: 'armado', name: 'Armado', type: 'productive' },
      ],
      // Todo el CIF cae en el servicio (1.000 f / 500 v) para aislar el secundario.
      concepts: [
        { name: 'CIF Mantenimiento', amount: { fixed: 1000, variable: 500 }, distribution: { mantenimiento: 1 } },
      ],
      // El servicio reparte en modo 'base'; NO hay toProductive tipeado a mano.
      serviceDistributions: [
        { serviceCenterId: 'mantenimiento', distributionMode: 'base', baseCode: 'HM' },
      ],
      closureOrder: ['mantenimiento'],
      productiveSettings: [],
    });

    // Antes de resolver la base, el reparto está vacío (queda en cero).
    expect(config.serviceDistributions[0]!.distributions).toEqual([]);

    // Resolvedor de la base "HM" (horas-máquina): 300 en Corte, 200 en Armado.
    const resolved = applySecondaryAllocationBases(config, (code) =>
      code === 'HM' ? { corte: 300, armado: 200 } : undefined,
    );

    // Las unidades se volcaron a PARES EXPLÍCITOS → el motor puede derivar los %.
    // En modo 'base', fijo y variable comparten la misma base (mismas unidades).
    expect(resolved.serviceDistributions[0]!.distributions).toEqual([
      { centroDestinoId: 'corte', fijo: 300, variable: 300 },
      { centroDestinoId: 'armado', fijo: 200, variable: 200 },
    ]);

    const budgets = computeProductiveBudgets(resolved);
    // 300/500 = 60% → Corte 600 f / 300 v ; 200/500 = 40% → Armado 400 f / 200 v.
    expect(budgets.corte).toEqual({ fixed: 600, variable: 300 });
    expect(budgets.armado).toEqual({ fixed: 400, variable: 200 });
    // No se pierde ni un centavo: Σ productivos = Σ primario.
    expect(budgets.corte!.fixed + budgets.armado!.fixed).toBeCloseTo(1000, 2);
    expect(budgets.corte!.variable + budgets.armado!.variable).toBeCloseTo(500, 2);
  });

  it('modo manual queda EXACTAMENTE igual (cero regresión)', () => {
    const config = indirectCostConfigSchema.parse({
      centers: [
        { id: 'mantenimiento', name: 'Mantenimiento', type: 'service' },
        { id: 'corte', name: 'Corte', type: 'productive' },
        { id: 'armado', name: 'Armado', type: 'productive' },
      ],
      concepts: [
        { name: 'CIF', amount: { fixed: 1000, variable: 500 }, distribution: { mantenimiento: 1 } },
      ],
      // Reparto manual (default 'manual'): % tipeados a mano.
      serviceDistributions: [
        { serviceCenterId: 'mantenimiento', toProductive: { corte: 70, armado: 30 } },
      ],
      closureOrder: ['mantenimiento'],
      productiveSettings: [],
    });

    // Aunque exista un resolvedor, un servicio 'manual' NO se toca.
    const resolved = applySecondaryAllocationBases(config, () => ({ corte: 1, armado: 1 }));
    expect(resolved.serviceDistributions).toEqual(config.serviceDistributions);

    const budgets = computeProductiveBudgets(resolved);
    expect(budgets.corte).toEqual({ fixed: 700, variable: 350 });
    expect(budgets.armado).toEqual({ fixed: 300, variable: 150 });
  });

  it('ignora auto-referencia y centros inexistentes; base sin valores no toca nada', () => {
    const config = indirectCostConfigSchema.parse({
      centers: [
        { id: 'mantenimiento', name: 'Mantenimiento', type: 'service' },
        { id: 'corte', name: 'Corte', type: 'productive' },
        { id: 'armado', name: 'Armado', type: 'productive' },
      ],
      concepts: [
        { name: 'CIF', amount: { fixed: 1000, variable: 0 }, distribution: { mantenimiento: 1 } },
      ],
      serviceDistributions: [
        { serviceCenterId: 'mantenimiento', distributionMode: 'base', baseCode: 'HM' },
      ],
      closureOrder: ['mantenimiento'],
      productiveSettings: [],
    });

    // Unidades incluyen basura: el propio servicio, un centro que no existe y un 0.
    const resolved = applySecondaryAllocationBases(config, () => ({
      mantenimiento: 999, // auto-referencia → se ignora
      fantasma: 500, // no existe → se ignora
      corte: 300,
      armado: 0, // 0 no suma a la base → se ignora
    }));
    expect(resolved.serviceDistributions[0]!.distributions).toEqual([
      { centroDestinoId: 'corte', fijo: 300, variable: 300 },
    ]);

    // Una base que todavía no tiene valores (resolvedor → undefined) deja el
    // reparto como estaba (vacío), sin romper.
    const untouched = applySecondaryAllocationBases(config, () => undefined);
    expect(untouched.serviceDistributions[0]!.distributions).toEqual([]);
  });
});
