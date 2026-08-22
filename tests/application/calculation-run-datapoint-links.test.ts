import { describe, it, expect } from 'vitest';
import { runCalculation, type CalculationInput } from '@/domain/calculations/calculate.js';
import { buildCalculationTree, type TreeNode } from '@/application/cost-structures/tree-builder.js';
import {
  resolveDataPointLinks,
  type DataPointLinkSource,
} from '@/application/cost-structures/calculation-run-service.js';

/**
 * T-02 — EL ÁRBOL NO SE PUEDE ATAR A LOS DATOS POR COMPARACIÓN DE TEXTO.
 *
 * `attachDataPointSources` decidía el origen de cada nodo comparando el `label`
 * del nodo contra el `label` del DataPoint, como strings. Eso falla de las dos
 * peores maneras posibles:
 *
 *   · en SILENCIO ante un renombre — cambiar una etiqueta en `tree-builder.ts` o
 *     en el formulario desconecta el drill-down entero sin un solo error ni un
 *     test en rojo; y
 *   · sin poder DESEMPATAR dos datos con la misma etiqueta (dos compras al mismo
 *     proveedor en el mismo mes): el índice se queda con el último, y el primer
 *     nodo termina apuntando al dato equivocado.
 *
 * Estas pruebas fijan las dos cosas. `resolverPorEtiqueta` reproduce el resolutor
 * ANTERIOR a T-02 para dejar demostrado, en el mismo archivo, que fallaba.
 */

/** El resolutor pre-T-02, tal cual era: `byLabel.get(node.label)`. */
function resolverPorEtiqueta(tree: TreeNode[], existing: DataPointLinkSource[]): void {
  const byLabel = new Map(existing.map((d) => [d.label, d.id]));
  const walk = (nodes: TreeNode[]) => {
    for (const node of nodes) {
      const dpId = byLabel.get(node.label);
      if (dpId) node.sourceDataPointId = dpId;
      if (node.children.length > 0) walk(node.children);
    }
  };
  walk(tree);
}

const baseInput: CalculationInput = {
  rawMaterial: {
    materials: [
      {
        id: 'chapa', name: 'Chapa', code: 'CH-18', unit: 'kg',
        wilson: { annualDemand: 6000, orderCost: 500, holdingRate: 0.3, unitCost: 1200 },
        stockPolicy: { minConsumption: 10, maxConsumption: 30, minLeadTime: 5, maxLeadTime: 10, safetyStock: 50 },
        initialStock: { quantity: 300, unitCost: 1160 },
        movements: [
          { date: '2026-08-05', type: 'purchase', detail: 'Factura A-0001', quantity: 200, unitCost: 1300 },
          { date: '2026-08-20', type: 'consumption', detail: 'Vale 77', quantity: 350 },
        ],
      },
    ],
  },
  directLabor: {
    workingDays: {
      totalDaysPerYear: 365,
      unpaidAbsence: { sundays: 52, saturdays: 52, unjustifiedAbsences: 3, holidaysOnWeekend: 4 },
      paidAbsence: { holidays: 12, vacations: 14, sickness: 5, specialLeaves: 2, workAccidents: 1 },
    },
    itcs: {
      derivationBase: 0.27,
      fixedArt: 0.015,
      uncertainRemunerative: [{ name: 'Vacaciones', coefficient: 0.06 }],
      uncertainNonRemunerative: [],
    },
    departments: [
      { name: 'Corte', basicRemuneration: 900000, hoursWorked: 1600 },
      { name: 'Armado', basicRemuneration: 750000, hoursWorked: 1400 },
    ],
  },
  indirectCosts: {
    centers: [
      { id: 'prod1', name: 'Corte', type: 'productive' },
      { id: 'prod2', name: 'Armado', type: 'productive' },
    ],
    concepts: [
      { name: 'Alquiler', amount: { fixed: 200000, variable: 0 }, distribution: { prod1: 0.6, prod2: 0.4 } },
    ],
    serviceDistributions: [],
    productiveSettings: [
      { centerId: 'prod1', normalCapacity: 1600, actualActivity: 1500, actualCip: 250000 },
      { centerId: 'prod2', normalCapacity: 1400, actualActivity: 1350, actualCip: 160000 },
    ] as CalculationInput['indirectCosts']['productiveSettings'],
  },
  inventory: { initialWorkInProcess: 0, finalWorkInProcess: 0, initialFinishedGoods: 0, finalFinishedGoods: 0 },
  sales: { unitPrice: 5000, quantity: 800 },
};

/** Los DataPoints tal como los deja el guardado de secciones (T-01). */
const dataPoints: DataPointLinkSource[] = [
  { id: 'dp-mp-config', fieldKey: 'mp.config', label: 'Materia Prima (bloque migrado)' },
  { id: 'dp-mod-config', fieldKey: 'mod.config', label: 'Mano de Obra (bloque migrado)' },
  { id: 'dp-cip-config', fieldKey: 'cip.config', label: 'Costos Indirectos (bloque migrado)' },
  { id: 'dp-venta-config', fieldKey: 'venta.config', label: 'Venta (bloque migrado)' },
  { id: 'dp-rem-corte', fieldKey: 'mod.dpto.Corte.remuneracion', label: 'Remuneración básica · Corte' },
  { id: 'dp-rem-armado', fieldKey: 'mod.dpto.Armado.remuneracion', label: 'Remuneración básica · Armado' },
  { id: 'dp-cip-prod1', fieldKey: 'cip.centro.prod1.cipReal', label: 'CIP real · Corte' },
  { id: 'dp-cip-prod2', fieldKey: 'cip.centro.prod2.cipReal', label: 'CIP real · Armado' },
  { id: 'dp-precio', fieldKey: 'venta.precio_unitario', label: 'Precio unitario' },
  { id: 'dp-cantidad', fieldKey: 'venta.cantidad_vendida', label: 'Cantidad' },
  {
    id: 'dp-compra-cant', fieldKey: 'mp.compra.cantidad',
    label: 'Compra — Factura A-0001', fechaHecho: new Date('2026-08-05'),
  },
  {
    id: 'dp-compra-precio', fieldKey: 'mp.compra.precio',
    label: 'Compra — Factura A-0001', fechaHecho: new Date('2026-08-05'),
  },
  {
    id: 'dp-consumo-cant', fieldKey: 'mp.consumo.cantidad',
    label: 'Consumo — Vale 77', fechaHecho: new Date('2026-08-20'),
  },
];

function arbol(input: CalculationInput = baseInput): TreeNode[] {
  return buildCalculationTree(input, runCalculation(input));
}

/** Busca una hoja por (etiqueta del padre, etiqueta propia). */
function hoja(tree: TreeNode[], padre: string, label: string): TreeNode {
  const buscar = (nodes: TreeNode[], p: string): TreeNode | undefined => {
    for (const n of nodes) {
      if (p === padre && n.label === label) return n;
      const hit = buscar(n.children, n.label);
      if (hit) return hit;
    }
    return undefined;
  };
  const found = buscar(tree, '');
  if (!found) throw new Error(`no existe la hoja «${padre} › ${label}»`);
  return found;
}

describe('T-02 — enlace determinístico entre el árbol y sus datos', () => {
  it('las 4 raíces siguen resolviendo por su fieldKey fija', () => {
    const tree = arbol();
    resolveDataPointLinks(tree, dataPoints);
    expect(tree.map((r) => r.sourceDataPointId)).toEqual([
      'dp-mp-config',
      'dp-mod-config',
      'dp-cip-config',
      'dp-venta-config',
    ]);
  });

  it('cada hoja repetida resuelve a SU dato (departamento, centro, venta)', () => {
    const tree = arbol();
    resolveDataPointLinks(tree, dataPoints);
    expect(hoja(tree, 'Corte', 'Remuneración básica').sourceDataPointId).toBe('dp-rem-corte');
    expect(hoja(tree, 'Armado', 'Remuneración básica').sourceDataPointId).toBe('dp-rem-armado');
    expect(hoja(tree, 'Corte', 'CIP real').sourceDataPointId).toBe('dp-cip-prod1');
    expect(hoja(tree, 'Armado', 'CIP real').sourceDataPointId).toBe('dp-cip-prod2');
    expect(hoja(tree, 'Ingreso', 'Precio unitario').sourceDataPointId).toBe('dp-precio');
    expect(hoja(tree, 'Ingreso', 'Cantidad').sourceDataPointId).toBe('dp-cantidad');
  });

  it('los movimientos de MP resuelven a su dato de cantidad', () => {
    const tree = arbol();
    resolveDataPointLinks(tree, dataPoints);
    const mp = tree[0]!;
    expect(mp.children.find((c) => c.label === 'Compra — Factura A-0001')!.sourceDataPointId)
      .toBe('dp-compra-cant');
    expect(mp.children.find((c) => c.label === 'Consumo — Vale 77')!.sourceDataPointId)
      .toBe('dp-consumo-cant');
  });

  // -----------------------------------------------------------------------
  // El renombre: la prueba que el código pre-T-02 NO pasa
  // -----------------------------------------------------------------------
  describe('renombrar una etiqueta no desconecta el drill-down', () => {
    /** Renombra todas las hojas enlazables, como haría un cambio de copy. */
    function renombrar(tree: TreeNode[]): void {
      const walk = (nodes: TreeNode[]) => {
        for (const n of nodes) {
          n.label = `${n.label} (texto nuevo)`;
          walk(n.children);
        }
      };
      walk(tree);
    }

    it('el enlace SOBREVIVE al renombre con el resolutor de T-02', () => {
      const tree = arbol();
      renombrar(tree);
      resolveDataPointLinks(tree, dataPoints);

      expect(hoja(tree, 'Corte (texto nuevo)', 'Remuneración básica (texto nuevo)').sourceDataPointId)
        .toBe('dp-rem-corte');
      expect(hoja(tree, 'Armado (texto nuevo)', 'CIP real (texto nuevo)').sourceDataPointId)
        .toBe('dp-cip-prod2');
      expect(hoja(tree, 'Ingreso (texto nuevo)', 'Precio unitario (texto nuevo)').sourceDataPointId)
        .toBe('dp-precio');
      expect(
        tree[0]!.children.find((c) => c.label === 'Compra — Factura A-0001 (texto nuevo)')!
          .sourceDataPointId,
      ).toBe('dp-compra-cant');
      // Y las raíces también, que nunca dependieron de la etiqueta.
      expect(tree.map((r) => r.sourceDataPointId)).toEqual([
        'dp-mp-config', 'dp-mod-config', 'dp-cip-config', 'dp-venta-config',
      ]);
    });

    it('con el resolutor PRE-T-02 (solo etiqueta) el enlace se pierde entero', () => {
      const tree = arbol();
      renombrar(tree);
      resolverPorEtiqueta(tree, dataPoints);

      // Ni una sola hoja queda enlazada: eso es exactamente el bug, y pasaba en
      // silencio porque nada lo miraba.
      const conOrigen: string[] = [];
      const walk = (nodes: TreeNode[]) => {
        for (const n of nodes) {
          if (n.sourceDataPointId) conOrigen.push(n.label);
          walk(n.children);
        }
      };
      walk(tree);
      expect(conOrigen).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // Dos movimientos con el MISMO detalle en el mismo período
  // -----------------------------------------------------------------------
  describe('dos compras con el mismo detalle en el mismo período', () => {
    const dosCompras: CalculationInput = {
      ...baseInput,
      rawMaterial: {
        materials: [
          {
            ...baseInput.rawMaterial.materials[0]!,
            movements: [
              { date: '2026-08-05', type: 'purchase', detail: 'Proveedor X', quantity: 200, unitCost: 1300 },
              { date: '2026-08-05', type: 'purchase', detail: 'Proveedor X', quantity: 150, unitCost: 1400 },
            ],
          },
        ],
      },
    };

    /** Dos data points hermanos: misma fieldKey, misma etiqueta, misma fecha. */
    const puntos: DataPointLinkSource[] = [
      {
        id: 'dp-compra-1', fieldKey: 'mp.compra.cantidad',
        label: 'Compra — Proveedor X', fechaHecho: new Date('2026-08-05'),
      },
      {
        id: 'dp-compra-1-precio', fieldKey: 'mp.compra.precio',
        label: 'Compra — Proveedor X', fechaHecho: new Date('2026-08-05'),
      },
      {
        id: 'dp-compra-2', fieldKey: 'mp.compra.cantidad',
        label: 'Compra — Proveedor X', fechaHecho: new Date('2026-08-05'),
      },
      {
        id: 'dp-compra-2-precio', fieldKey: 'mp.compra.precio',
        label: 'Compra — Proveedor X', fechaHecho: new Date('2026-08-05'),
      },
    ];

    it('cada nodo resuelve a SU propio dato, no los dos al último', () => {
      const tree = arbol(dosCompras);
      resolveDataPointLinks(tree, puntos);

      const movimientos = tree[0]!.children.filter((c) => c.label === 'Compra — Proveedor X');
      expect(movimientos).toHaveLength(2);
      expect(movimientos.map((m) => m.sourceDataPointId)).toEqual(['dp-compra-1', 'dp-compra-2']);
    });

    it('el resolutor PRE-T-02 mandaba las DOS al mismo dato', () => {
      const tree = arbol(dosCompras);
      resolverPorEtiqueta(tree, puntos);

      const ids = tree[0]!.children
        .filter((c) => c.label === 'Compra — Proveedor X')
        .map((m) => m.sourceDataPointId);
      expect(ids[0]).toBe(ids[1]); // los dos al último del índice: uno miente
    });
  });

  // -----------------------------------------------------------------------
  // Datos migrados: el respaldo por etiqueta sigue funcionando
  // -----------------------------------------------------------------------
  it('un dato migrado SIN fieldKey estable sigue enlazando por etiqueta', () => {
    const tree = arbol();
    // Estructura anterior a T-01: el dato existe con una `fieldKey` que el árbol
    // no nombra, y lo único en común es la etiqueta.
    const migrados: DataPointLinkSource[] = [
      { id: 'dp-viejo', fieldKey: 'legacy.desconocida', label: 'Precio unitario' },
    ];
    resolveDataPointLinks(tree, migrados);
    expect(hoja(tree, 'Ingreso', 'Precio unitario').sourceDataPointId).toBe('dp-viejo');
  });

  it('sin dato detrás, el nodo queda sin origen (no se inventa ninguno)', () => {
    const tree = arbol();
    resolveDataPointLinks(tree, dataPoints);
    expect(hoja(tree, 'Corte', 'Tarifa horaria integral').sourceDataPointId).toBeUndefined();
    expect(hoja(tree, 'Corte', 'Variación volumen').sourceDataPointId).toBeUndefined();
  });
});
