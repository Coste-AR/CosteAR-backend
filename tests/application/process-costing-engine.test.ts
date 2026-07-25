import { describe, it, expect } from 'vitest';
import {
  ProcessCostingEngine,
  PROCESS_ENGINE_VERSION,
  type ProcessCalculationInput,
  type ProcessDepartmentInput,
} from '@/application/cost-structures/process-costing/process-costing-engine.js';
import { selectCostingEngine } from '@/application/cost-structures/costing-engine.js';
import { OrdersCostingEngine } from '@/application/cost-structures/orders-costing-engine.js';
import type { TreeNode } from '@/application/cost-structures/tree-builder.js';

/**
 * B17 — MOTOR DE COSTEO POR PROCESOS (integración de las funciones puras B06-B11).
 *
 * FX-P1 (Azur Alcoholes, Destilado + Purificado, abril) es el caso ancla de la
 * cátedra corrido DE PUNTA A PUNTA por el motor sobre una estructura de 2
 * departamentos: el costo del departamento 1 se transfiere al 2 y los números
 * finales deben reproducir los de la hoja de costos, célula a célula.
 */

/** Busca un nodo del árbol (primero que matchea `pred`), en profundidad. */
function findNode(nodes: TreeNode[], pred: (n: TreeNode) => boolean): TreeNode | undefined {
  for (const n of nodes) {
    if (pred(n)) return n;
    const inner = findNode(n.children, pred);
    if (inner) return inner;
  }
  return undefined;
}

/** Aplana todas las hojas (nodos sin hijos) del árbol. */
function leaves(nodes: TreeNode[]): TreeNode[] {
  return nodes.flatMap((n) => (n.children.length === 0 ? [n] : leaves(n.children)));
}

const PERIOD = 'per-abril';

/** FX-P1 · Destilado (seq 1), conversión unificada, CC al 80 % en la EF. */
const destilado: ProcessDepartmentInput = {
  id: 'dept-destilado',
  name: 'Destilado',
  sequence: 1,
  conversionUnified: true,
  periodId: PERIOD,
  units: {
    initialWip: 5000,
    startedInProduction: 30000,
    transferredOut: 30000,
    finishedInStock: 0,
    normalLossPct: 0.02, // 600 normal
    totalLossReported: 1600, // 600 normal + 1000 extraordinaria
    // finalWip derivada = 3.400
  },
  finalWipConversionAvance: 0.8,
  costs: {
    mpInicial: 8800,
    mpPeriodo: 60000, // MP total 68.800 ÷ 34.400 = 2,00
    moInicial: 6510,
    moPeriodo: 52500, // CC total 59.010 ÷ 33.720 = 1,75
  },
};

/** FX-P1 · Purificado (seq 2), conversión unificada, CC al 40 % en la EF. */
const purificado: ProcessDepartmentInput = {
  id: 'dept-purificado',
  name: 'Purificado',
  sequence: 2,
  conversionUnified: true,
  periodId: PERIOD,
  units: {
    initialWip: 3320,
    receivedFromPrevious: 30000,
    unitIncrease: 2000,
    transferredOut: 29000,
    finishedInStock: 0,
    normalLossPct: 0.01, // normal 320; sin extraordinaria
    // finalWip derivada = 6.000
  },
  finalWipConversionAvance: 0.4,
  costs: {
    mpInicial: 5000,
    mpPeriodo: 30000, // MP total 35.000 ÷ 35.000 = 1,00
    moInicial: 12800,
    moPeriodo: 50000, // CC total 62.800 ÷ 31.400 = 2,00
  },
  // Costo del anterior arrastrado en la EI (no hay columna en la tabla; el motor
  // lo modela por input para reproducir el costo modificado $3,50 de la cátedra).
  initialWipTransferredCost: 11120,
};

describe('B17 — ProcessCostingEngine · FX-P1 end to end (Azur Alcoholes, abril)', () => {
  const engine = new ProcessCostingEngine();
  const input: ProcessCalculationInput = { departments: [destilado, purificado] };

  it('reproduce Destilado: MP $2,00 / CC $1,75 / total $3,75 y EF $11.560', () => {
    const { results } = engine.run(input);
    const d = results.departments.find((x) => x.name === 'Destilado')!;

    const mp = d.report.elements.find((e) => e.element === 'MP')!;
    const cc = d.report.elements.find((e) => e.element === 'CC')!;
    expect(mp.costoUnitario).toBe(2);
    expect(cc.costoUnitario).toBe(1.75);
    expect(d.report.costoUnitarioTotalAcumulado).toBe(3.75);
    // EF por AMBOS caminos = $11.560.
    expect(d.report.costoExistenciaFinalPorDiferencia).toBe(11560);
    expect(d.report.valuacionExistenciaFinalPorElemento).toBe(11560);
    expect(d.report.ajustePorRedondeo).toBe(0);
  });

  it('reproduce Purificado: costo modificado $3,50, CAUP $0,032, transferido $3,532, total $6,532 y EF $31.992', () => {
    const { results } = engine.run(input);
    const p = results.departments.find((x) => x.name === 'Purificado')!;

    // Costo transferido del anterior (B09) reconstruido en la cadena.
    expect(p.transferredCost).toBeDefined();
    expect(p.transferredCost!.costoModificado).toBe(3.5);
    expect(p.transferredCost!.caup).toBe(0.032);
    expect(p.transferredCost!.costoTransferido).toBe(3.532);
    expect(p.transferredCost!.unidadesBuenas).toBe(35000);

    // Sección A del informe = 35.000 × 3,532 = 123.620.
    expect(p.report.previousDepartment!.costoTotal).toBe(123620);
    // Costo unitario total = 3,532 + 1,00 + 2,00 = 6,532.
    expect(p.report.costoUnitarioTotalAcumulado).toBe(6.532);
    // EF por elemento = 31.992 (anterior 21.192 + MP 6.000 + CC 4.800).
    expect(p.report.valuacionExistenciaFinalPorElemento).toBe(31992);
    expect(p.report.costoExistenciaFinalPorDiferencia).toBe(31992);
  });

  it('el costo final de la estructura es el costo unitario del último departamento', () => {
    const { results } = engine.run(input);
    expect(results.finalUnitCost).toBe(6.532);
    expect(results.finalDepartmentName).toBe('Purificado');
    expect(engine.engineVersion).toBe(PROCESS_ENGINE_VERSION);
  });

  it('el árbol tiene UNA RAÍZ POR DEPARTAMENTO, rotulada por departamento', () => {
    const { tree } = engine.run(input);
    expect(tree).toHaveLength(2);
    expect(tree[0]!.label).toBe('Departamento 1º — Destilado');
    expect(tree[1]!.label).toBe('Departamento 2º — Purificado');
    // La raíz del 2º departamento abre el costo transferido (modificado + CAUP).
    expect(findNode([tree[1]!], (n) => n.label === 'Costo modificado')).toBeDefined();
    expect(findNode([tree[1]!], (n) => n.label.startsWith('CAUP'))).toBeDefined();
  });

  it('las hojas del cuadro llevan su traceFieldKey (enlace a DataPoint)', () => {
    const { tree } = engine.run(input);
    const allLeaves = leaves(tree);
    // La hoja "Terminadas y transferidas" del Destilado apunta a su fieldKey.
    const key = allLeaves.find((l) => l.traceFieldKey === `proceso.cuadro.${PERIOD}.dept-destilado.transferredOut`);
    expect(key).toBeDefined();
    expect(key!.value).toBe(30000);
    // Toda hoja con traceFieldKey usa el prefijo estable del cuadro de Procesos.
    const keyed = allLeaves.filter((l) => l.traceFieldKey);
    expect(keyed.length).toBeGreaterThan(0);
    expect(keyed.every((l) => l.traceFieldKey!.startsWith('proceso.cuadro.'))).toBe(true);
  });
});

describe('B17 — ProcessCostingEngine · cadena de 3 departamentos transfiere el costo 1→2→3', () => {
  const engine = new ProcessCostingEngine();

  /** Departamento lineal simple: sin EI, sin pérdidas, sin aumento (transfiere limpio). */
  const linear = (
    id: string,
    name: string,
    sequence: number,
    received: number,
    mpPeriodo: number,
    ccPeriodo: number,
  ): ProcessDepartmentInput => ({
    id,
    name,
    sequence,
    conversionUnified: true,
    periodId: PERIOD,
    units: {
      ...(sequence === 1 ? { startedInProduction: received } : { receivedFromPrevious: received }),
      transferredOut: received,
      finishedInStock: 0,
      finalWip: 0,
    },
    finalWipConversionAvance: 1,
    costs: { mpPeriodo, moPeriodo: ccPeriodo },
  });

  it('cada departamento acumula su costo sobre el transferido del anterior', () => {
    const input: ProcessCalculationInput = {
      departments: [
        linear('d1', 'Cocción', 1, 1000, 1000, 1000), // unit 2,00
        linear('d2', 'Enfriado', 2, 1000, 500, 500), // 2,00 + 1,00 = 3,00
        linear('d3', 'Envasado', 3, 1000, 1000, 0), // 3,00 + 1,00 = 4,00
      ],
    };
    const { results, tree } = engine.run(input);

    const [d1, d2, d3] = results.departments;
    expect(d1!.report.costoUnitarioTotalAcumulado).toBe(2);
    expect(d2!.transferredCost!.costoTransferido).toBe(2); // recibe 2,00 del 1º
    expect(d2!.report.costoUnitarioTotalAcumulado).toBe(3);
    expect(d3!.transferredCost!.costoTransferido).toBe(3); // recibe 3,00 del 2º
    expect(d3!.report.costoUnitarioTotalAcumulado).toBe(4);

    expect(results.finalUnitCost).toBe(4);
    expect(tree).toHaveLength(3);
    expect(tree.map((r) => r.label)).toEqual([
      'Departamento 1º — Cocción',
      'Departamento 2º — Enfriado',
      'Departamento 3º — Envasado',
    ]);
  });
});

describe('B17 — selectCostingEngine despacha el motor correcto', () => {
  it("'PROCESSES' devuelve el ProcessCostingEngine (ya no el placeholder 422)", () => {
    const engine = selectCostingEngine('PROCESSES');
    expect(engine).toBeInstanceOf(ProcessCostingEngine);
    expect(engine.engineVersion).toBe(PROCESS_ENGINE_VERSION);
  });

  it("'ORDERS' y ausente siguen devolviendo el motor de Órdenes (cero regresión)", () => {
    expect(selectCostingEngine('ORDERS')).toBeInstanceOf(OrdersCostingEngine);
    expect(selectCostingEngine(null)).toBeInstanceOf(OrdersCostingEngine);
    expect(selectCostingEngine(undefined)).toBeInstanceOf(OrdersCostingEngine);
  });
});
