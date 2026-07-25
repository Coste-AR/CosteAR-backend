import type { CostingSystem } from '@prisma/client';
import type { CalculationInput, CalculationOutput } from '../../domain/calculations/calculate.js';
import type { TreeNode } from './tree-builder.js';
import { CostingSystemNotAvailableError } from '../../domain/errors/calculation-errors.js';
import { OrdersCostingEngine } from './orders-costing-engine.js';

/**
 * Contrato común de un MOTOR DE COSTEO (patrón Strategy). Cada sistema de costeo
 * de la cátedra —Órdenes hoy, Procesos (B17) mañana— lo implementa por separado.
 *
 * La regla de oro del refactor B02: introducir este contrato NO cambia ni un
 * número del costeo por Órdenes. El motor recibe los insumos YA resueltos
 * (`CalculationInput`: la config de la estructura + los datos del período) y
 * devuelve EXACTAMENTE lo que el camino actual ya producía —`results` (el output
 * del cálculo) y `tree` (el árbol de derivación para `calculation_nodes`)—, sin
 * inventar una forma nueva. La persistencia, la auditoría y la marca de
 * incompletitud viven fuera del motor, en el servicio que lo invoca.
 */
export interface CostingResult {
  /** Output consolidado del cálculo (mismo shape que `runCalculation`). */
  results: CalculationOutput;
  /** Árbol de derivación (nodos de `calculation_nodes`), sin persistir todavía. */
  tree: TreeNode[];
}

export interface CostingEngine {
  /**
   * Versión del motor con la que se calculó. Se persiste en `CalculationRun`
   * para saber, mirando una corrida vieja, con qué lógica se calculó. Cada motor
   * expone la suya (el de Procesos tendrá su propia versión).
   */
  readonly engineVersion: string;

  /** Corre el motor sobre los insumos ya resueltos. Es una función pura. */
  run(input: CalculationInput): CostingResult;
}

/**
 * DESPACHO por sistema de costeo (patrón Strategy). Devuelve el motor que
 * corresponde a la estructura. Hoy solo existe el de Órdenes; Procesos (B17)
 * sumará su caso acá. Mientras tanto, PROCESSES devuelve un 422 accionable en
 * castellano —nunca un 500—: la estructura se puede crear como Procesos (B01),
 * pero calcularla todavía no está disponible.
 *
 * Cualquier valor que no sea PROCESSES (ORDERS, o ausente en estructuras viejas)
 * cae en el motor de Órdenes: es el default histórico y garantiza cero regresión.
 */
export function selectCostingEngine(costingSystem: CostingSystem | null | undefined): CostingEngine {
  if (costingSystem === 'PROCESSES') {
    throw new CostingSystemNotAvailableError();
  }
  return new OrdersCostingEngine();
}
