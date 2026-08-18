import type { FrozenCalculation } from './calculate.js';

/**
 * CONGELAR UN PERÍODO DE COSTEO POR PROCESOS.
 *
 * El cierre de un período guarda una foto de sus números. Hasta acá esa foto la
 * producía siempre el motor de ÓRDENES, sin mirar el sistema de costeo — con lo
 * cual una estructura de Procesos nunca podía cerrar un período, y como no se
 * puede abrir uno nuevo mientras haya otro abierto, quedaba trabada para
 * siempre en el primero.
 *
 * Esta función traduce el informe de costos por departamento a la misma forma
 * que usa Órdenes.
 *
 * ¿POR QUÉ LA MISMA FORMA Y NO UNA PROPIA?
 * ----------------------------------------
 * Porque los TRES ELEMENTOS DEL COSTO —materia prima, mano de obra directa y
 * carga fabril— son los mismos en los dos sistemas. Es el eje de toda la
 * cátedra: lo que cambia entre Órdenes y Procesos es cómo se ACUMULAN, no
 * cuáles son. Con la forma compartida, la comparación entre períodos ("el costo
 * unitario subió 12%, ¿de dónde vino?") funciona igual en los dos sistemas sin
 * escribir una segunda implementación.
 *
 * QUÉ NO SE PUEDE LLENAR, Y POR QUÉ
 * ---------------------------------
 * El detalle POR MATERIA PRIMA (`detail.rawMaterial.materials`) queda vacío. En
 * Costeo por Procesos el cuadro de movimiento registra el costo de MP incurrido
 * por departamento, no abierto por material: ese detalle no existe en el
 * sistema, y fabricarlo sería inventar. La comparación pierde ese nivel de
 * drill-down en Procesos y conserva el de departamentos, que sí existe.
 */

/** Un departamento del período, con lo que hace falta para congelarlo. */
export interface ProcessFreezeDepartment {
  name: string;
  sequence: number;
  /** Costos incurridos EN EL PERÍODO (no los que venían en la existencia inicial). */
  periodCostMp: number;
  periodCostMo: number;
  periodCostCif: number;
  /** Unidades terminadas y transferidas × costo unitario total acumulado. */
  costoTerminadasYTransferidas: number;
  /** Unidades terminadas y guardadas × costo unitario total acumulado. */
  costoTerminadasEnStock: number;
  /** Costo unitario total acumulado del departamento. */
  costoUnitarioTotalAcumulado: number;
}

export interface ProcessFreezeInput {
  /** En orden de secuencia. El último es el que termina el producto. */
  departments: ProcessFreezeDepartment[];
  salesUnitPrice: number;
  salesQuantity: number;
  /** Unidades producidas del período. Si falta, el costo unitario cae a las vendidas. */
  productionQuantity: number | null;
}

/** Divide sin devolver Infinity ni NaN: sin denominador, el resultado es 0. */
function safeDiv(a: number, b: number): number {
  return b === 0 ? 0 : a / b;
}

export function freezeProcessPeriod(input: ProcessFreezeInput): FrozenCalculation {
  const deps = [...input.departments].sort((a, b) => a.sequence - b.sequence);

  const sum = (f: (d: ProcessFreezeDepartment) => number) => deps.reduce((a, d) => a + f(d), 0);

  const rawMaterialConsumed = sum((d) => d.periodCostMp);
  const directLaborTotal = sum((d) => d.periodCostMo);
  const indirectCostsApplied = sum((d) => d.periodCostCif);

  // COSTO DE PRODUCCIÓN DEL PERÍODO.
  //
  // Es lo que TERMINÓ el último departamento: transferido al depósito más lo que
  // quedó terminado en existencia. No es la suma de los costos de todos los
  // departamentos — eso contaría varias veces el mismo costo, porque cada
  // departamento arrastra el del anterior. Y no incluye la producción en proceso:
  // esas unidades no son producto terminado todavía.
  const last = deps[deps.length - 1];
  const productionCost = last
    ? last.costoTerminadasYTransferidas + last.costoTerminadasEnStock
    : 0;

  const finalUnitCost = last?.costoUnitarioTotalAcumulado ?? 0;

  const salesRevenue = input.salesUnitPrice * input.salesQuantity;
  const costOfGoodsSold = finalUnitCost * input.salesQuantity;
  const grossMargin = salesRevenue - costOfGoodsSold;
  const grossMarginPct = safeDiv(grossMargin, salesRevenue) * 100;

  // Unidades para el costo unitario: las PRODUCIDAS. `productionQuantity` y
  // `salesQuantity` son campos de la pestaña Venta (Costeo por Órdenes) que en
  // Procesos nunca se cargan — caer a `salesQuantity` acá siempre da 0. La
  // fuente real ya está calculada arriba: terminadas y transferidas + terminadas
  // en stock del último departamento, que es exactamente `productionCost /
  // finalUnitCost`. Solo si ni eso hay (finalUnitCost 0) se cae a las vendidas.
  const unitsProduced =
    input.productionQuantity ?? (finalUnitCost !== 0 ? productionCost / finalUnitCost : input.salesQuantity);

  // De dónde salió el divisor. En Procesos, aunque no se cargue `productionQuantity`,
  // las unidades se DERIVAN del cuadro de movimiento — que es la fuente real de la
  // producción del período. Solo se cae a las vendidas si ni eso hay.
  const basadoEn: 'producidas' | 'vendidas' =
    input.productionQuantity != null || finalUnitCost !== 0 ? 'producidas' : 'vendidas';

  return {
    rawMaterialConsumed,
    directLaborTotal,
    indirectCostsApplied,
    productionCost,
    costOfGoodsSold,
    grossMargin,
    grossMarginPct,
    detail: {
      rawMaterial: {
        optimalLot: 0,
        finalStockQty: 0,
        finalStockValue: 0,
        // Vacío a propósito: en Procesos la MP se registra por departamento, no
        // por material. Ver la nota del encabezado.
        materials: [],
      },
      directLabor: {
        workingDays: 0,
        paidDays: 0,
        itcsPercent: 0,
        iapPercent: 0,
        hourlyRates: {},
        itcsBreakdown: {
          certain: 0,
          uncertainRemunerative: 0,
          derived: 0,
          uncertainNonRemunerative: 0,
        },
        // El drill-down por departamento SÍ existe en Procesos, y es el que más
        // sirve: los departamentos de proceso son unidades productivas reales.
        departments: deps.map((d) => ({
          name: d.name,
          basicRemuneration: d.periodCostMo,
          socialChargesCost: 0,
          totalMod: d.periodCostMo,
          hourlyRate: 0,
          budgetedHours: 0,
        })),
      },
      indirectCosts: {
        perDepartment: Object.fromEntries(
          deps.map((d) => [
            d.name,
            {
              cipTotal: d.periodCostCif,
              appliedCip: d.periodCostCif,
              // En Procesos la carga fabril del período se asigna directo al
              // departamento: no hay cuota predeterminada ni, por lo tanto,
              // variaciones que informar. Cero acá significa "no aplica", y es
              // preferible a un número inventado.
              budgetVariance: 0,
              volumeVariance: 0,
              normalCapacity: 0,
              actualActivity: 0,
              quota: 0,
              actualCip: d.periodCostCif,
              budgetFixed: 0,
              budgetVariable: 0,
              quotaFixed: 0,
              quotaVariable: 0,
              overUnderApplied: 0,
              pendingClosing: false,
              appliedOn: 'actualActivity' as const,
            },
          ]),
        ),
      },
      unitCost: {
        unitsProduced,
        // El costo unitario ya está calculado arriba (`finalUnitCost`): dividir
        // productionCost/unitsProduced de nuevo es la misma cuenta rehecha con
        // más riesgo de redondeo, y si unitsProduced cae a 0 devuelve $0 sobre un
        // costo que el motor sí calculó bien (H11).
        unitProductionCost: finalUnitCost,
        unitCostOfGoodsSold: safeDiv(costOfGoodsSold, unitsProduced),
        basadoEn,
      },
    },
  };
}
