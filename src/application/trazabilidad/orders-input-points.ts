import type {
  RawMaterialSection,
  RawMaterialConfig,
  DirectLaborConfig,
  IndirectCostConfig,
} from '../../shared/schemas/cost.schema.js';
import { nombreDeCentro } from '../../shared/schemas/cost.schema.js';
import type {
  CaptureMethod,
  CostElement,
  SourceArea,
} from '../../shared/schemas/trazabilidad.schema.js';

/**
 * QUÉ DATOS TRAZABLES TIENE CADA SECCIÓN DE COSTEO POR ÓRDENES.
 *
 * Módulo PURO (no toca la base): traduce el JSON de una sección
 * (`rawMaterialConfig`, `directLaborConfig`, `indirectCostConfig`, venta) a la
 * lista de INSUMOS que el sistema promete poder abrir — un `DataPoint` por cada
 * número que alguien cargó a mano.
 *
 * Existe separado del reconciliador porque se usa dos veces por guardado: una
 * con la config NUEVA (lo que tiene que existir) y otra con la ANTERIOR (para
 * saber qué insumo ya estaba y por lo tanto es un huérfano a REPARAR, no un dato
 * recién capturado — ver `datapoint-reconciler.ts`).
 *
 * Convención de `fieldKey`: la que ya venía usando el sistema
 * ('mp.compra.cantidad', 'mp.compra.precio', 'mod.dpto.horas', ...), extendida
 * con el discriminante que hace única la clave dentro de la estructura
 * (materia prima, departamento, centro, concepto).
 */

/** Un insumo trazable tal como TIENE que quedar guardado después del save. */
export interface DesiredPoint {
  /**
   * Clave de MATCHEO contra lo ya persistido. Casi siempre es la `fieldKey`,
   * salvo en los movimientos de MP, donde N movimientos comparten la misma
   * `fieldKey` legada y se distinguen por (etiqueta, fecha, rol, repetición).
   */
  identity: string;
  element: CostElement;
  fieldKey: string;
  label: string;
  unit?: string;
  sourceArea: SourceArea;
  valueNum: number;
  valueJson?: Record<string, unknown>;
  /** ISO 'YYYY-MM-DD' del hecho, solo donde el dato lo tiene (movimientos). */
  fechaHecho?: string;
  /**
   * Período al que pertenece el dato. `null` = pendiente de decisión (spec D.3).
   * Ver `movementPeriod()` para la única regla que deja algo en `null`.
   */
  periodoImputado: string | null;
  /**
   * Método de captación propio del dato, cuando NO es el del guardado. Solo lo
   * usan los derivados (el presupuesto por centro, que lo calcula el prorrateo).
   */
  method?: CaptureMethod;
  /**
   * Movimiento de MP al que pertenece el dato (cantidad y precio son hermanos).
   * El reconciliador lo usa para que los dos compartan `valueJson.movementId`.
   */
  movementGroup?: string;
}

/** Las cuatro secciones de Órdenes que guardan insumos trazables. */
export type OrdersSection = 'rawMaterial' | 'directLabor' | 'indirectCosts' | 'sales';

/** Prefijo de `fieldKey` que "posee" cada sección (ámbito de la reconciliación). */
export const SECTION_PREFIX: Record<OrdersSection, string> = {
  rawMaterial: 'mp.',
  directLabor: 'mod.',
  indirectCosts: 'cip.',
  sales: 'venta.',
};

/**
 * Claves de los BLOQUES migrados por `scripts/backfill-trazabilidad.mjs`: un
 * DataPoint por sección entera, con el JSON completo adentro. Quedan FUERA de la
 * reconciliación (no son insumos individuales y el árbol los usa para enlazar
 * las cuatro raíces). Anularlos rompería el drill-down de la raíz.
 */
export const LEGACY_BLOCK_FIELD_KEYS = ['mp.config', 'mod.config', 'cip.config', 'venta.config'];

/**
 * `fieldKey` legadas de los movimientos de MP. Son COMPARTIDAS por todos los
 * movimientos (las creó así el formulario de MP) y `listMpMovements` filtra
 * exactamente por ellas para armar la ficha de imputación: cambiarlas dejaría
 * los movimientos fuera de esa pantalla. Por eso el matcheo de movimientos no
 * puede ser por `fieldKey` sola.
 */
export const MP_MOVEMENT_FIELD_KEYS = [
  'mp.compra.cantidad',
  'mp.compra.precio',
  'mp.consumo.cantidad',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Fecha de un movimiento a ISO 'YYYY-MM-DD'. Acepta la forma ISO y la argentina
 * (DD/MM/AAAA) que llega de las importaciones. Si no se entiende, devuelve null:
 * un dato sin fecha reconocible no inventa una — queda sin `fechaHecho` y sin
 * imputación (o sea, pendiente), que es exactamente lo que es.
 */
export function toIsoDate(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(raw);
  if (iso) return iso[1]!;
  const ar = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw.trim());
  if (ar) return `${ar[3]}-${ar[2]}-${ar[1]}`;
  return null;
}

/**
 * Imputación de un MOVIMIENTO. Misma regla que ya aplica el frontend
 * (`proposeImputation`): si el hecho cae en el mismo mes que el período de
 * costo, se imputa solo; si cae en otro, la decisión es de una persona y el
 * dato queda PENDIENTE. No se replica acá ninguna regla nueva a propósito —
 * dos criterios distintos para el mismo dato es peor que ninguno.
 */
export function movementPeriod(isoDate: string | null, period: string): string | null {
  if (!isoDate) return null;
  return isoDate.slice(0, 7) === period ? period : null;
}

/** Discriminante estable de una materia prima dentro de la sección. */
function materialKey(m: RawMaterialConfig, i: number): string {
  return (m.id ?? m.code ?? m.name ?? `mp${i + 1}`).trim().slice(0, 60) || `mp${i + 1}`;
}

/** Nombre humano de una materia prima (para la etiqueta de la ficha). */
function materialName(m: RawMaterialConfig, i: number): string {
  return (m.name ?? m.code ?? `Materia prima ${i + 1}`).trim() || `Materia prima ${i + 1}`;
}

/**
 * Identidad de un dato de movimiento: la `fieldKey` legada no alcanza (la
 * comparten todos), así que se completa con lo que SÍ identifica al movimiento
 * — la misma tripleta (tipo, detalle, fecha) que ya usa el formulario de MP
 * para reconocer un movimiento guardado — más el rol y un contador de
 * repeticiones (dos compras iguales el mismo día son dos datos distintos).
 */
export function movementIdentity(
  fieldKey: string,
  label: string,
  isoDate: string | null,
  role: string,
  occurrence: number,
): string {
  return `${fieldKey}|${label}|${isoDate ?? ''}|${role}|${occurrence}`;
}

/** Etiqueta de un movimiento, IDÉNTICA a la que emite el árbol de derivación. */
export function movementLabel(type: 'purchase' | 'consumption', detail: string): string {
  return `${type === 'purchase' ? 'Compra' : 'Consumo'} — ${detail}`;
}

/** Lleva la cuenta de repeticiones de una misma identidad base. */
function nextOccurrence(counter: Map<string, number>, base: string): number {
  const n = counter.get(base) ?? 0;
  counter.set(base, n + 1);
  return n;
}

// ---------------------------------------------------------------------------
// `fieldKey` que el árbol de derivación necesita nombrar (enlace determinístico)
// ---------------------------------------------------------------------------

/** Remuneración básica de un departamento de MOD. */
export function modDeptRemunerationKey(deptName: string): string {
  return `mod.dpto.${deptName}.remuneracion`;
}

/** Horas (capacidad normal) de un departamento de MOD. */
export function modDeptHoursKey(deptName: string): string {
  return `mod.dpto.${deptName}.horas`;
}

/** CIP real de un centro productivo. */
export function cipCenterActualCipKey(centerId: string): string {
  return `cip.centro.${centerId}.cipReal`;
}

// ---------------------------------------------------------------------------
// Materia Prima
// ---------------------------------------------------------------------------

export function rawMaterialPoints(section: RawMaterialSection, period: string): DesiredPoint[] {
  const out: DesiredPoint[] = [];
  const counter = new Map<string, number>();

  section.materials.forEach((m, i) => {
    const key = materialKey(m, i);
    const name = materialName(m, i);

    const param = (
      suffix: string,
      label: string,
      unit: string,
      valueNum: number,
      sourceArea: SourceArea,
    ): void => {
      const fieldKey = `mp.${key}.${suffix}`;
      out.push({
        identity: fieldKey,
        element: 'MP',
        fieldKey,
        label: `${label} · ${name}`,
        unit,
        sourceArea,
        valueNum,
        valueJson: { scope: 'mp.parametro', materialKey: key },
        periodoImputado: period,
      });
    };

    // Existencia inicial: cantidad la sabe depósito, precio lo sabe contaduría.
    param('existencia_inicial.cantidad', 'Existencia inicial (cantidad)', 'u', m.initialStock.quantity, 'deposito');
    param('existencia_inicial.precio', 'Existencia inicial (precio unitario)', '$', m.initialStock.unitCost, 'contaduria');

    // Insumos del lote óptimo (Wilson). El LOTE es derivado; estos cuatro no.
    param('wilson.demanda_anual', 'Wilson — demanda anual (R)', 'u', m.wilson.annualDemand, 'costista');
    param('wilson.costo_pedido', 'Wilson — costo de pedido (S)', '$', m.wilson.orderCost, 'costista');
    param('wilson.tasa_almacenamiento', 'Wilson — tasa de almacenamiento (K)', '%', m.wilson.holdingRate, 'costista');
    param('wilson.costo_unitario', 'Wilson — costo unitario (C)', '$', m.wilson.unitCost, 'costista');

    // Movimientos: cantidad y precio son DOS datos hermanos, con autores
    // distintos (depósito cuenta bultos; contaduría lee la factura). El manual
    // exige que no se fusionen en uno solo.
    for (const mv of m.movements) {
      const label = movementLabel(mv.type, mv.detail);
      const iso = toIsoDate(mv.date);
      const periodo = movementPeriod(iso, period);
      const group = `${label}|${iso ?? ''}|${nextOccurrence(counter, `${label}|${iso ?? ''}`)}`;

      const cantidadKey = mv.type === 'purchase' ? 'mp.compra.cantidad' : 'mp.consumo.cantidad';
      out.push({
        identity: movementIdentity(
          cantidadKey,
          label,
          iso,
          'cantidad',
          nextOccurrence(counter, `${cantidadKey}|${label}|${iso ?? ''}|cantidad`),
        ),
        element: 'MP',
        fieldKey: cantidadKey,
        label,
        unit: 'u',
        sourceArea: mv.type === 'purchase' ? 'deposito' : 'planta',
        valueNum: mv.quantity,
        valueJson: { role: 'cantidad', materialKey: key },
        ...(iso ? { fechaHecho: iso } : {}),
        periodoImputado: periodo,
        movementGroup: group,
      });

      if (mv.type === 'purchase') {
        out.push({
          identity: movementIdentity(
            'mp.compra.precio',
            label,
            iso,
            'precio',
            nextOccurrence(counter, `mp.compra.precio|${label}|${iso ?? ''}|precio`),
          ),
          element: 'MP',
          fieldKey: 'mp.compra.precio',
          label,
          unit: '$',
          sourceArea: 'contaduria',
          valueNum: mv.unitCost ?? 0,
          valueJson: { role: 'precio', materialKey: key },
          ...(iso ? { fechaHecho: iso } : {}),
          periodoImputado: periodo,
          movementGroup: group,
        });
      }
    }
  });

  return out;
}

// ---------------------------------------------------------------------------
// Mano de Obra Directa
// ---------------------------------------------------------------------------

export function directLaborPoints(cfg: DirectLaborConfig, period: string): DesiredPoint[] {
  const out: DesiredPoint[] = [];
  const push = (
    fieldKey: string,
    label: string,
    unit: string,
    valueNum: number,
    sourceArea: SourceArea,
  ): void => {
    out.push({
      identity: fieldKey,
      element: 'MOD',
      fieldKey,
      label,
      unit,
      sourceArea,
      valueNum,
      periodoImputado: period,
    });
  };

  // Días de trabajo efectivo: los insumos, no el resultado.
  const wd = cfg.workingDays;
  push('mod.dias.total_anual', 'Días totales del año', 'días', wd.totalDaysPerYear, 'contaduria');
  push('mod.dias.no_pago.domingos', 'Ausentismo no pago — domingos', 'días', wd.unpaidAbsence.sundays, 'contaduria');
  push('mod.dias.no_pago.sabados', 'Ausentismo no pago — sábados', 'días', wd.unpaidAbsence.saturdays, 'contaduria');
  push('mod.dias.no_pago.injustificadas', 'Ausentismo no pago — inasistencias injustificadas', 'días', wd.unpaidAbsence.unjustifiedAbsences, 'contaduria');
  push('mod.dias.no_pago.feriados_fin_de_semana', 'Ausentismo no pago — feriados en fin de semana', 'días', wd.unpaidAbsence.holidaysOnWeekend, 'contaduria');
  push('mod.dias.pago.feriados', 'Ausentismo pago — feriados', 'días', wd.paidAbsence.holidays, 'contaduria');
  push('mod.dias.pago.vacaciones', 'Ausentismo pago — vacaciones', 'días', wd.paidAbsence.vacations, 'contaduria');
  push('mod.dias.pago.enfermedad', 'Ausentismo pago — enfermedad', 'días', wd.paidAbsence.sickness, 'contaduria');
  push('mod.dias.pago.licencias_especiales', 'Ausentismo pago — licencias especiales', 'días', wd.paidAbsence.specialLeaves, 'contaduria');
  push('mod.dias.pago.accidentes', 'Ausentismo pago — accidentes de trabajo', 'días', wd.paidAbsence.workAccidents, 'contaduria');

  // ITCS: base de derivación, ART fija y CADA coeficiente incierto (que es
  // justamente el número que alguien estima y que después hay que poder mirar).
  push('mod.itcs.base_derivacion', 'ITCS — base de derivación', '%', cfg.itcs.derivationBase, 'contaduria');
  push('mod.itcs.art_fija', 'ITCS — ART (parte fija)', '%', cfg.itcs.fixedArt, 'contaduria');
  if (cfg.itcs.sacFraction !== undefined) {
    push('mod.itcs.fraccion_sac', 'ITCS — fracción de SAC', '%', cfg.itcs.sacFraction, 'contaduria');
  }
  for (const c of cfg.itcs.uncertainRemunerative) {
    push(
      `mod.itcs.incierta_remunerativa.${c.name}`,
      `ITCS — incierta remunerativa: ${c.name}`,
      '%',
      c.coefficient,
      'contaduria',
    );
  }
  for (const c of cfg.itcs.uncertainNonRemunerative) {
    push(
      `mod.itcs.incierta_no_remunerativa.${c.name}`,
      `ITCS — incierta no remunerativa: ${c.name}`,
      '%',
      c.coefficient,
      'contaduria',
    );
  }

  // Por departamento: remuneración básica (contaduría) y horas (planta).
  for (const d of cfg.departments) {
    push(modDeptRemunerationKey(d.name), `Remuneración básica · ${d.name}`, '$', d.basicRemuneration, 'contaduria');
    push(modDeptHoursKey(d.name), `Horas presupuestadas · ${d.name}`, 'hs', d.hoursWorked, 'planta');
    if (d.realHours !== undefined) {
      push(`mod.dpto.${d.name}.horas_reales`, `Horas reales · ${d.name}`, 'hs', d.realHours, 'planta');
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Costos Indirectos de Producción
// ---------------------------------------------------------------------------

export function indirectCostPoints(cfg: IndirectCostConfig, period: string): DesiredPoint[] {
  const out: DesiredPoint[] = [];
  const push = (
    fieldKey: string,
    label: string,
    unit: string,
    valueNum: number,
    sourceArea: SourceArea,
    method?: CaptureMethod,
  ): void => {
    out.push({
      identity: fieldKey,
      element: 'CIP',
      fieldKey,
      label,
      unit,
      sourceArea,
      valueNum,
      periodoImputado: period,
      ...(method ? { method } : {}),
    });
  };

  for (const c of cfg.concepts) {
    push(`cip.concepto.${c.name}.importe.fijo`, `${c.name} — importe fijo`, '$', c.amount.fixed, 'contaduria');
    push(`cip.concepto.${c.name}.importe.variable`, `${c.name} — importe variable`, '$', c.amount.variable, 'contaduria');
  }

  for (const s of cfg.productiveSettings) {
    const centro = nombreDeCentro(cfg.centers, s.centerId);
    // El PRESUPUESTO no lo tipea nadie: sale del prorrateo primario + el cierre
    // del secundario. Se guarda igual —es un insumo de la cuota— pero declarado
    // como lo que es: `calculado` por el sistema. Inventarle un autor humano
    // sería exactamente lo que el manual prohíbe.
    push(`cip.centro.${s.centerId}.presupuesto.fijo`, `Presupuesto fijo · ${centro}`, '$', s.budget.fixed, 'sistema', 'calculado');
    push(`cip.centro.${s.centerId}.presupuesto.variable`, `Presupuesto variable · ${centro}`, '$', s.budget.variable, 'sistema', 'calculado');
    push(`cip.centro.${s.centerId}.capacidad_normal`, `Capacidad normal · ${centro}`, 'u', s.normalCapacity, 'planta');
    push(`cip.centro.${s.centerId}.actividad_real`, `Actividad real · ${centro}`, 'u', s.actualActivity, 'planta');
    push(cipCenterActualCipKey(s.centerId), `CIP real · ${centro}`, '$', s.actualCip, 'contaduria');
  }

  return out;
}

// ---------------------------------------------------------------------------
// Venta
// ---------------------------------------------------------------------------

export function salesPoints(
  sales: { unitPrice: number; quantity: number; productionQuantity: number | null },
  period: string,
): DesiredPoint[] {
  const out: DesiredPoint[] = [
    {
      identity: 'venta.precio_unitario',
      element: 'VENTA',
      fieldKey: 'venta.precio_unitario',
      // Etiqueta IDÉNTICA a la hoja del árbol ("Precio unitario"), para que el
      // enlace por etiqueta la encuentre sin ayuda.
      label: 'Precio unitario',
      unit: '$',
      sourceArea: 'comercial',
      valueNum: sales.unitPrice,
      periodoImputado: period,
    },
    {
      identity: 'venta.cantidad_vendida',
      element: 'VENTA',
      fieldKey: 'venta.cantidad_vendida',
      label: 'Cantidad',
      unit: 'u',
      sourceArea: 'comercial',
      valueNum: sales.quantity,
      periodoImputado: period,
    },
  ];

  if (sales.productionQuantity !== null && sales.productionQuantity !== undefined) {
    out.push({
      identity: 'venta.cantidad_producida',
      element: 'VENTA',
      fieldKey: 'venta.cantidad_producida',
      label: 'Cantidad producida',
      unit: 'u',
      sourceArea: 'planta',
      valueNum: sales.productionQuantity,
      periodoImputado: period,
    });
  }

  return out;
}
