import type { CostingSystem } from '@prisma/client';
import type { CalculationInput, CalculationOutput } from '../../domain/calculations/calculate.js';
import type { TreeNode } from './tree-builder.js';
import { OrdersCostingEngine } from './orders-costing-engine.js';
import {
  ProcessCostingEngine,
  type ProcessCalculationInput,
  type ProcessCalculationOutput,
} from './process-costing/process-costing-engine.js';

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
export interface CostingResult<TResult = CalculationOutput> {
  /** Output consolidado del cálculo (Órdenes: `CalculationOutput`; Procesos: informe por depto). */
  results: TResult;
  /** Árbol de derivación (nodos de `calculation_nodes`), sin persistir todavía. */
  tree: TreeNode[];
}

/**
 * `TInput`/`TResult` tienen default a los tipos de Órdenes, así que el motor de
 * Órdenes —y todo su código— sigue escribiéndose `CostingEngine` sin cambios
 * (byte-idéntico). El de Procesos parametriza con sus propios tipos (insumos por
 * departamento / informe por departamento).
 */
export interface CostingEngine<TInput = CalculationInput, TResult = CalculationOutput> {
  /**
   * Versión del motor con la que se calculó. Se persiste en `CalculationRun`
   * para saber, mirando una corrida vieja, con qué lógica se calculó. Cada motor
   * expone la suya (el de Procesos tiene su propia versión).
   */
  readonly engineVersion: string;

  /** Corre el motor sobre los insumos ya resueltos. Es una función pura. */
  run(input: TInput): CostingResult<TResult>;
}

/**
 * DESPACHO por sistema de costeo (patrón Strategy). Devuelve el motor que
 * corresponde a la estructura. Con B17, PROCESSES ya devuelve su motor
 * (`ProcessCostingEngine`) —reemplaza el placeholder 422 anterior—; cualquier
 * otro valor (ORDERS, o ausente en estructuras viejas) cae en el motor de
 * Órdenes, el default histórico que garantiza cero regresión.
 *
 * Sobrecargas para que el llamador reciba el tipo correcto: con la literal
 * 'PROCESSES' obtiene el motor de Procesos; con cualquier `CostingSystem` el de
 * Órdenes (el guardia de "estructura de Procesos por el endpoint equivocado"
 * vive en el servicio que la invoca, no acá).
 */
export function selectCostingEngine(costingSystem: 'PROCESSES'): ProcessCostingEngine;
export function selectCostingEngine(costingSystem: CostingSystem | null | undefined): OrdersCostingEngine;
export function selectCostingEngine(
  costingSystem: CostingSystem | null | undefined,
): CostingEngine<CalculationInput, CalculationOutput> | CostingEngine<ProcessCalculationInput, ProcessCalculationOutput> {
  if (costingSystem === 'PROCESSES') {
    return new ProcessCostingEngine();
  }
  return new OrdersCostingEngine();
}
