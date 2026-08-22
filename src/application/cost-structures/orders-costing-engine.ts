import { runCalculation, ENGINE_VERSION, type CalculationInput } from '../../domain/calculations/calculate.js';
import { buildCalculationTree } from './tree-builder.js';
import type { CostingEngine, CostingResult } from './costing-engine.js';

/**
 * Motor de COSTEO POR ÓRDENES (implementación Strategy del `CostingEngine`).
 *
 * Es una EXTRACCIÓN, no una reescritura: envuelve el camino de cálculo que ya
 * estaba verificado al centavo contra la cátedra —`runCalculation` (Hojas 1-4) y
 * `buildCalculationTree` (árbol de derivación)— sin tocar una sola fórmula. Todas
 * las llamadas de dominio (materia prima, mano de obra directa, costos
 * indirectos, estado de costos, bases de asignación, prorrateo) quedan
 * exactamente donde estaban. Mover la orquestación a esta clase deja el resultado
 * BYTE-IDÉNTICO y prepara el terreno para el motor de Procesos (B17) sin ramificar
 * la función de cálculo, que es la vía más rápida a una regresión silenciosa.
 */
export class OrdersCostingEngine implements CostingEngine {
  readonly engineVersion = ENGINE_VERSION;

  run(input: CalculationInput): CostingResult {
    const results = runCalculation(input);
    const tree = buildCalculationTree(input, results);
    return { results, tree };
  }
}
