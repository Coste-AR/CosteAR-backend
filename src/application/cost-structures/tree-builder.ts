import type { CalculationInput, CalculationOutput } from './calculate.js';

/**
 * Arma el árbol de derivación {label, formula, value, unit, children[]} a
 * partir de los objetos YA calculados por el motor (`output.raw`). No
 * recalcula nada — solo reorganiza resultados existentes en forma de árbol
 * para persistir en `calculation_nodes`. El frontend hace drill-down leyendo
 * este árbol, nunca recalculando (spec sección B).
 *
 * Las 4 raíces son los elementos del costo: MP, MOD, CIP, VENTA (spec D.1).
 */

export interface TreeNode {
  label: string;
  formula?: string;
  value: number | null;
  unit?: string;
  children: TreeNode[];
  /**
   * DataPoint (no versión) que respalda este nodo, si existe uno trazado con
   * el mismo `label` para la estructura. Se completa después de construir el
   * árbol (ver `calculation-run-service.ts`) — el builder en sí no conoce la
   * DB. No participa del cálculo: es puramente de trazabilidad (D.1/D.2).
   */
  sourceDataPointId?: string;
}

export function buildCalculationTree(input: CalculationInput, output: CalculationOutput): TreeNode[] {
  return [
    buildRawMaterialNode(output),
    buildDirectLaborNode(output),
    buildIndirectCostsNode(output),
    buildSalesNode(input, output),
  ];
}

function buildRawMaterialNode(output: CalculationOutput): TreeNode {
  const { ledger, optimalLot } = output.raw;
  return {
    label: 'Materia Prima Consumida',
    formula: 'Existencia Inicial + Compras − Existencia Final (valuado a PPP)',
    value: output.rawMaterialConsumed,
    unit: '$',
    children: [
      {
        label: 'Lote óptimo (Wilson)',
        formula: 'LE = √(2·R·S / (K·C))',
        value: optimalLot.toNumber(),
        unit: 'u',
        children: [],
      },
      {
        label: 'Stock final',
        formula: 'saldo en unidades × PPP vigente',
        value: output.detail.rawMaterial.finalStockValue,
        unit: '$',
        children: [],
      },
      ...ledger.rows.map((row) => ({
        label: `${row.type === 'purchase' ? 'Compra' : 'Consumo'} — ${row.detail}`,
        formula:
          row.type === 'purchase'
            ? `${row.quantity.toNumber()} u × $ ${row.movementUnitCost.toNumber()}`
            : `${row.quantity.toNumber()} u × PPP $ ${row.movementUnitCost.toNumber()}`,
        value: row.movementTotal.toNumber(),
        unit: '$',
        children: [],
      })),
    ],
  };
}

function buildDirectLaborNode(output: CalculationOutput): TreeNode {
  const { labor } = output.raw;
  return {
    label: 'Mano de Obra Directa',
    formula: 'Σ (remuneración básica × (1 + ITCS)) por departamento',
    value: output.directLaborTotal,
    unit: '$',
    children: [
      {
        label: 'Días de trabajo efectivo',
        formula: 'días totales − ausentismo no pago − ausentismo pago',
        value: labor.workingDays.effectiveWorkDays.toNumber(),
        unit: 'días',
        children: [],
      },
      {
        label: 'IAP — Inasistencias Pagas',
        formula: 'ausentismo pago / días efectivos',
        value: labor.workingDays.iap.toPercent(),
        unit: '%',
        children: [],
      },
      {
        label: 'ITCS — Índice Total de Cargas Sociales',
        formula: 'CSC + B40 + F40 + B47',
        value: labor.itcs.itcs.toPercent(),
        unit: '%',
        children: [
          { label: 'Cargas Sociales Ciertas (CSC)', value: labor.itcs.certainCharges.toPercent(), unit: '%', children: [] },
          { label: 'Inciertas remunerativas (B40)', value: labor.itcs.uncertainRemunerativeCoefs.toPercent(), unit: '%', children: [] },
          { label: 'Cargas derivadas (F40)', value: labor.itcs.derivedCharges.toPercent(), unit: '%', children: [] },
          { label: 'Inciertas no remunerativas (B47)', value: labor.itcs.uncertainNonRemunerative.toPercent(), unit: '%', children: [] },
        ],
      },
      ...labor.departments.map((d) => ({
        label: d.name,
        formula: 'básica × (1 + ITCS)',
        value: d.totalMod.toNumber(),
        unit: '$',
        children: [
          { label: 'Remuneración básica', value: d.basicRemuneration.toNumber(), unit: '$', children: [] },
          { label: 'Costo de cargas sociales', value: d.socialChargesCost.toNumber(), unit: '$', children: [] },
          { label: 'Tarifa horaria integral', formula: 'costo total / HH', value: d.hourlyRate.toNumber(), unit: '$/hs', children: [] },
        ],
      })),
    ],
  };
}

function buildIndirectCostsNode(output: CalculationOutput): TreeNode {
  const { indirectPerDepartment } = output.raw;
  return {
    label: 'Costos Indirectos de Producción Aplicados',
    formula: 'Σ (cuota total × actividad real) por centro productivo',
    value: output.indirectCostsApplied,
    unit: '$',
    children: Object.entries(indirectPerDepartment).map(([centerId, d]) => ({
      label: centerId,
      formula: 'cuota total × actividad real',
      value: d.variance.cipApplied.toNumber(),
      unit: '$',
      children: [
        { label: 'Cuota fija', value: d.quota.fixedQuota.toNumber(), unit: '$', children: [] },
        { label: 'Cuota variable', value: d.quota.variableQuota.toNumber(), unit: '$', children: [] },
        { label: 'CIP real', value: d.actualCip.toNumber(), unit: '$', children: [] },
        {
          label: 'Variación presupuesto',
          formula: 'CIP real − presupuesto ajustado al nivel real',
          value: d.variance.budgetVariance.toNumber(),
          unit: '$',
          children: [],
        },
        {
          label: 'Variación volumen',
          formula: 'cuota fija × (capacidad normal − actividad real)',
          value: d.variance.volumeVariance.toNumber(),
          unit: '$',
          children: [],
        },
      ],
    })),
  };
}

function buildSalesNode(input: CalculationInput, output: CalculationOutput): TreeNode {
  const { margin, statement } = output.raw;
  return {
    label: 'Venta y Margen',
    formula: 'Ingreso − Costo de los Productos Vendidos',
    value: output.grossMargin,
    unit: '$',
    children: [
      {
        label: 'Ingreso',
        formula: 'precio unitario × cantidad',
        value: margin.salesRevenue.toNumber(),
        unit: '$',
        children: [
          { label: 'Precio unitario', value: input.sales.unitPrice, unit: '$', children: [] },
          { label: 'Cantidad', value: input.sales.quantity, unit: 'u', children: [] },
        ],
      },
      {
        label: 'Costo de producción',
        formula: 'MP consumida + MOD + CIP aplicado',
        value: statement.productionCost.toNumber(),
        unit: '$',
        children: [],
      },
      { label: 'Costo de los Productos Vendidos (COGS)', value: output.costOfGoodsSold, unit: '$', children: [] },
      { label: 'Margen %', formula: 'margen / ingreso', value: output.grossMarginPct, unit: '%', children: [] },
    ],
  };
}
