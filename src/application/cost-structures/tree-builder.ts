import type { CalculationInput, CalculationOutput } from '../../domain/calculations/calculate.js';
import {
  cipCenterActualCipKey,
  modDeptRemunerationKey,
  movementIdentity,
  movementLabel,
  toIsoDate,
} from '../trazabilidad/orders-input-points.js';

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
  /**
   * Clave estable del DataPoint que respalda este nodo. Es la MISMA convención
   * que usa el lado de ESCRITURA (`trazabilidad/orders-input-points.ts`): para
   * casi todo, la `fieldKey` textual del dato; para los movimientos de materia
   * prima —que comparten una `fieldKey` legada entre todos— la `identity` que
   * arma `movementIdentity()`, que es lo único que distingue dos movimientos.
   *
   * La arma el motor —que sí conoce el (materia prima, departamento, centro,
   * período)— y el servicio la resuelve a un `sourceDataPointId` con UNA query.
   * Es la alternativa DETERMINÍSTICA al matcheo por `label`, que se rompe en
   * silencio ante cualquier renombre y no puede desempatar etiquetas repetidas.
   * Aditiva: un árbol sin ella se comporta igual que antes.
   */
  traceFieldKey?: string;
}

/**
 * `fieldKey` de la sección VENTA que el árbol necesita nombrar. Los literales
 * son los que emite `salesPoints()` en `orders-input-points.ts` (única fuente de
 * verdad del lado de escritura): si cambian allá, cambian acá.
 */
const VENTA_PRECIO_UNITARIO_KEY = 'venta.precio_unitario';
const VENTA_CANTIDAD_VENDIDA_KEY = 'venta.cantidad_vendida';

/**
 * `fieldKey` legadas y COMPARTIDAS de los movimientos de MP (ver
 * `MP_MOVEMENT_FIELD_KEYS`). Solo se nombra la del dato de CANTIDAD: es el que
 * existe tanto en compras como en consumos, y su `valueJson.movementId` hermana
 * la cantidad con el precio, así que abrir la ficha desde ahí muestra el
 * movimiento entero.
 */
const MP_COMPRA_CANTIDAD_KEY = 'mp.compra.cantidad';
const MP_CONSUMO_CANTIDAD_KEY = 'mp.consumo.cantidad';

export function buildCalculationTree(input: CalculationInput, output: CalculationOutput): TreeNode[] {
  return [
    buildRawMaterialNode(output),
    buildDirectLaborNode(output),
    buildIndirectCostsNode(input, output),
    buildSalesNode(input, output),
  ];
}

/** Lleva la cuenta de repeticiones de una misma identidad base. */
function nextOccurrence(counter: Map<string, number>, base: string): number {
  const n = counter.get(base) ?? 0;
  counter.set(base, n + 1);
  return n;
}

function buildRawMaterialNode(output: CalculationOutput): TreeNode {
  const { materials } = output.raw;

  // Con una sola MP, se muestran sus movimientos directo bajo la raíz (igual
  // que antes). Con varias, se agrupa un sub-nodo por materia prima.
  const single = materials.length === 1;

  // Contador de repeticiones COMPARTIDO entre todas las materias primas, en el
  // mismo orden en que las recorre `rawMaterialPoints()` del lado de escritura
  // (materias primas en orden, movimientos en orden). Es lo que hace que dos
  // compras con el mismo detalle y la misma fecha resuelvan cada una a SU dato:
  // la primera es la ocurrencia 0 y la segunda la 1, de los dos lados.
  const counter = new Map<string, number>();

  const movementChildren = (ledger: (typeof materials)[number]['ledger']): TreeNode[] =>
    ledger.rows.map((row) => {
      const label = movementLabel(row.type, row.detail);
      const iso = toIsoDate(row.date);
      const fieldKey = row.type === 'purchase' ? MP_COMPRA_CANTIDAD_KEY : MP_CONSUMO_CANTIDAD_KEY;
      const occurrence = nextOccurrence(counter, `${fieldKey}|${label}|${iso ?? ''}|cantidad`);
      return {
        label,
        // La identidad sale de `movementLabel()` + `movementIdentity()`, los
        // MISMOS helpers que usa el lado de escritura: los dos lados derivan de
        // una sola definición y no pueden divergir por un renombre de copy en
        // este archivo. Lo que desempata dos movimientos con el mismo detalle
        // es (fecha, ocurrencia), nunca el texto libre.
        //
        // (Si alguna vez cambia `movementLabel` en sí, los DataPoint ya
        // guardados conservan la etiqueta vieja hasta el siguiente guardado de
        // la sección, que los reconcilia — no queda nada roto en firme.)
        traceFieldKey: movementIdentity(fieldKey, label, iso, 'cantidad', occurrence),
        formula:
          row.type === 'purchase'
            ? `${row.quantity.toNumber()} u × $ ${row.movementUnitCost.toNumber()}`
            : `${row.quantity.toNumber()} u × PPP $ ${row.movementUnitCost.toNumber()}`,
        value: row.movementTotal.toNumber(),
        unit: '$',
        children: [],
      };
    });

  const materialNode = (m: (typeof materials)[number]): TreeNode => ({
    label: m.config.name ? `${m.config.code ? m.config.code + ' · ' : ''}${m.config.name}` : 'Materia prima',
    formula: 'consumo valuado a PPP',
    value: m.ledger.rawMaterialConsumed.toNumber(),
    unit: '$',
    children: [
      {
        label: 'Lote óptimo (Wilson)',
        formula: 'LE = √(2·R·S / (K·C))',
        value: m.optimalLot.toNumber(),
        unit: 'u',
        children: [],
      },
      {
        label: 'Stock final',
        formula: 'saldo en unidades × PPP vigente',
        value: m.ledger.finalBalanceValue.toNumber(),
        unit: '$',
        children: [],
      },
      ...movementChildren(m.ledger),
    ],
  });

  return {
    label: 'Materia Prima Consumida',
    formula: single
      ? 'Existencia Inicial + Compras − Existencia Final (valuado a PPP)'
      : 'Σ consumo valuado a PPP de cada materia prima',
    value: output.rawMaterialConsumed,
    unit: '$',
    children: single ? materialNode(materials[0]!).children : materials.map(materialNode),
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
          // `traceFieldKey`: "Remuneración básica" se repite bajo CADA
          // departamento, así que el enlace por etiqueta no puede distinguirlas
          // (elegiría siempre el mismo dato). La clave nombra el departamento y
          // resuelve sin ambigüedad. Aditivo: no cambia ningún valor.
          {
            label: 'Remuneración básica',
            traceFieldKey: modDeptRemunerationKey(d.name),
            value: d.basicRemuneration.toNumber(),
            unit: '$',
            children: [],
          },
          { label: 'Costo de cargas sociales', value: d.socialChargesCost.toNumber(), unit: '$', children: [] },
          { label: 'Tarifa horaria integral', formula: 'costo total / HH', value: d.hourlyRate.toNumber(), unit: '$/hs', children: [] },
        ],
      })),
    ],
  };
}

function buildIndirectCostsNode(input: CalculationInput, output: CalculationOutput): TreeNode {
  const { indirectPerDepartment } = output.raw;

  // `indirectPerDepartment` está indexado por el ID INTERNO del centro ('prod1',
  // 'mec'), que no significa nada para el costista: el nodo se rotula con el
  // NOMBRE configurado en `indirectCosts.centers[]`, igual que ya hacía MOD con
  // `d.name`. Fallback al id SOLO si el centro no aparece en `centers[]` —
  // config vieja o centro borrado de la lista sin borrar su `productiveSetting`:
  // mostrar el id crudo es feo, pero es preferible a un nodo sin nombre.
  //
  // Los `calculation_nodes` YA PERSISTIDOS no se reescriben: una corrida vieja
  // conserva la etiqueta con la que se guardó (append-only, R1). Quien mira la
  // corrida #3 tiene que ver lo que decía la corrida #3.
  const centerNameById = new Map(input.indirectCosts.centers.map((c) => [c.id, c.name?.trim()]));

  return {
    label: 'Costos Indirectos de Producción Aplicados',
    formula: 'Σ (cuota total × actividad real) por centro productivo',
    value: output.indirectCostsApplied,
    unit: '$',
    children: Object.entries(indirectPerDepartment).map(([centerId, d]) => ({
      label: centerNameById.get(centerId) || centerId,
      formula: 'cuota total × actividad real',
      value: d.variance.cipApplied.toNumber(),
      unit: '$',
      children: [
        { label: 'Cuota fija', value: d.quota.fixedQuota.toNumber(), unit: '$', children: [] },
        { label: 'Cuota variable', value: d.quota.variableQuota.toNumber(), unit: '$', children: [] },
        // Mismo caso que "Remuneración básica": "CIP real" se repite por centro.
        {
          label: 'CIP real',
          traceFieldKey: cipCenterActualCipKey(centerId),
          value: d.actualCip.toNumber(),
          unit: '$',
          children: [],
        },
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
          // Estas dos hojas SÍ son datos cargados a mano. Hasta acá resolvían por
          // etiqueta —`salesPoints()` las rotula igual a propósito—, lo que las
          // dejaba a merced de cualquier renombre. La clave las ata a su dato.
          {
            label: 'Precio unitario',
            traceFieldKey: VENTA_PRECIO_UNITARIO_KEY,
            value: input.sales.unitPrice,
            unit: '$',
            children: [],
          },
          {
            label: 'Cantidad',
            traceFieldKey: VENTA_CANTIDAD_VENDIDA_KEY,
            value: input.sales.quantity,
            unit: 'u',
            children: [],
          },
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
