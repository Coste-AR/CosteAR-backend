import type { PrismaClient } from '@prisma/client';
import type { CalculationInput, CalculationOutput } from '../../domain/calculations/calculate.js';
import {
  calcularContribucionMarginal,
  CLAVES_COMPORTAMIENTO_CONTRIBUCION,
  type ContribucionMarginal,
  type FilaComportamiento,
} from '../../domain/calculations/contribucion-marginal.js';
import { calcularPuntoEquilibrio, type PuntoEquilibrio } from '../../domain/calculations/punto-equilibrio.js';
import {
  crearConversorUnidadGestion,
  type UnidadGestion,
} from '../../domain/units/unidad-gestion.js';

/** Resultado de incompletitud reutilizable entre caminos de cálculo. */
export interface Incompletitud {
  incompleto: boolean;
  motivos: string[];
  datosPendientes: { id: string; nombre: string }[];
}

/** Arma la marca sin exponer ids ni rutas internas en el motivo legible. */
export function buildIncompletitud(pending: { id: string; label: string }[]): Incompletitud {
  if (pending.length === 0) return { incompleto: false, motivos: [], datosPendientes: [] };

  const datosPendientes = pending.map((d) => ({ id: d.id, nombre: d.label }));
  const nombres = datosPendientes.map((d) => `"${d.nombre}"`).join(', ');
  return {
    incompleto: true,
    motivos: [
      `Hay ${pending.length} dato(s) sin decisión de imputación de período (${nombres}). ` +
        'El costo puede estar dejándolos afuera o mezclando datos de otro mes, así que este ' +
        'resultado todavía no es confiable. Resolvé la imputación desde la ficha de cada dato ' +
        'antes de dar el costo por bueno.',
    ],
    datosPendientes,
  };
}

export interface EnrichedCalculationResult {
  results: CalculationOutput & {
    incompletitud: Incompletitud;
    contribucionMarginal: ContribucionMarginal;
    puntoEquilibrio: PuntoEquilibrio;
    unidadGestion: UnidadGestion | null;
  };
  /** Snapshot persistible del motor, siempre en unidad base. */
  resultsBase: CalculationOutput & {
    incompletitud: Incompletitud;
    contribucionMarginal: ContribucionMarginal;
    puntoEquilibrio: PuntoEquilibrio;
  };
  incompletitud: Incompletitud;
  periodId: string | null;
}

/**
 * Agrega las vistas que dependen de datos persistidos al resultado puro del
 * motor. Corrida y simulación pasan por acá para que no puedan resolver una
 * clasificación, una incompletitud o un punto de equilibrio de forma distinta.
 */
export async function enrichCalculationResult(
  db: PrismaClient,
  args: {
    structureId: string;
    companyId: string | null;
    /**
     * El período que se está calculando. Es lo que fija contra qué fila resuelve
     * la cascada `período → estructura → empresa` de `resolverComportamiento`,
     * así que quien lo sepa TIENE que pasarlo (MX-04).
     *
     * Omitirlo cae al período abierto de la estructura. No es un error: hay dos
     * caminos que legítimamente calculan «la estructura» y no un período —el
     * botón de calcular de órdenes y la simulación—, y ahí el abierto es el que
     * el costista está mirando. Lo que no puede pasar es que un llamador que SÍ
     * conoce su período deje que lo adivine el fallback.
     */
    periodId?: string | null;
    input: CalculationInput;
    output: CalculationOutput;
  },
): Promise<EnrichedCalculationResult> {
  // M2-01. Gastos de no fabricación del período (`CostElement.VENTA`, hasta
  // ahora sin dónde cargarse — el punto de equilibrio del tablero era un
  // equilibrio DE PRODUCCIÓN, no de la empresa). Se leen del período ya
  // resuelto, igual que `unidadGestion` se lee de la empresa: el llamador no
  // tiene que acordarse de pasarlos, así que ningún caller nuevo puede
  // olvidarse de cablearlos (era exactamente el problema con `thirdPartyWork`
  // en `CalculationRunService.calculate()` — ver bitácora de esta tarea).
  //
  // A propósito NO pasan por `CalculationInput`/`calculate.ts`: no son un
  // costo de producción, nunca tocan el Estado de Costos ni el CPV — son
  // gasto del período, por debajo de esa línea. Meterlos en el motor
  // auditado sería tocar algo que estructuralmente no le corresponde
  // modelar (regla dura 1 del plan: "no se toca el motor auditado").
  const [pending, periodoResuelto, company] = await Promise.all([
    db.dataPoint.findMany({
      where: {
        structureId: args.structureId,
        periodoImputado: null,
        voidedAt: null,
        status: { not: 'anulado' },
      },
      select: { id: true, label: true },
      take: 20,
    }),
    args.periodId
      ? db.costPeriod.findFirst({
          where: { id: args.periodId },
          select: { id: true, gastoVariableComercializacionPorUnidad: true, gastoFijoAdministracion: true },
        })
      : // `orderBy` explícito porque una estructura PUEDE tener más de un período
        // abierto: `CostPeriodService.reopen()` reabre uno cerrado sin comprobar
        // que no haya otro OPEN, y el schema no lo impide. Sin orden, la base
        // elegía cualquiera. Se ordena igual que `CostPeriodService.getOpen()`.
        db.costPeriod.findFirst({
          where: { structureId: args.structureId, status: 'OPEN', deletedAt: null },
          select: { id: true, gastoVariableComercializacionPorUnidad: true, gastoFijoAdministracion: true },
          orderBy: { code: 'desc' },
        }),
    args.companyId
      ? db.company.findFirst({
          where: { id: args.companyId },
          select: {
            unidadGestion: { select: { codigo: true, nombre: true, factor: true } },
          },
        })
      : Promise.resolve(null),
  ]);
  const incompletitud = buildIncompletitud(pending);
  const periodId = args.periodId ?? periodoResuelto?.id ?? null;
  const gastosDeNoFabricacion = {
    gastoVariableComercializacionPorUnidad: Number(periodoResuelto?.gastoVariableComercializacionPorUnidad ?? 0),
    gastoFijoAdministracion: Number(periodoResuelto?.gastoFijoAdministracion ?? 0),
  };

  // Sin empresa sólo existen mocks históricos: no se consulta un tenant
  // inexistente y la contribución informa las clasificaciones faltantes.
  const clavesComportamiento = Object.values(CLAVES_COMPORTAMIENTO_CONTRIBUCION);
  const clasificaciones: FilaComportamiento[] = args.companyId
    ? await db.parametroCosteo.findMany({
        where: { companyId: args.companyId, clave: { in: clavesComportamiento }, deletedAt: null },
        select: {
          id: true,
          clave: true,
          comportamientoVolumen: true,
          structureId: true,
          periodId: true,
          clasificadoPorUserId: true,
          clasificadoEn: true,
        },
      })
    : [];
  const contribucionMarginal = calcularContribucionMarginal({
    precioUnitario: args.input.sales.unitPrice,
    unidadesVendidas: args.input.sales.quantity,
    componentes: [
      {
        clave: CLAVES_COMPORTAMIENTO_CONTRIBUCION.materiaPrima,
        etiqueta: 'Materia prima',
        importeAbsorcion: args.output.rawMaterialConsumed,
      },
      {
        clave: CLAVES_COMPORTAMIENTO_CONTRIBUCION.manoObraDirecta,
        etiqueta: 'Mano de obra directa',
        importeAbsorcion: args.output.directLaborTotal,
      },
      {
        clave: CLAVES_COMPORTAMIENTO_CONTRIBUCION.costosIndirectos,
        etiqueta: 'Costos indirectos de producción',
        importeAbsorcion: args.output.indirectCostsApplied,
      },
      // M2-01. Forzados: no pasan por la cascada de ParametroCosteo (ver el
      // comentario de comportamientoVolumenForzado en el dominio).
      {
        clave: CLAVES_COMPORTAMIENTO_CONTRIBUCION.gastosComercializacion,
        etiqueta: 'Gastos de comercialización',
        importeAbsorcion: gastosDeNoFabricacion.gastoVariableComercializacionPorUnidad * args.input.sales.quantity,
        comportamientoVolumenForzado: 'VARIABLE',
      },
      {
        clave: CLAVES_COMPORTAMIENTO_CONTRIBUCION.gastosAdministracion,
        etiqueta: 'Gastos de administración',
        importeAbsorcion: gastosDeNoFabricacion.gastoFijoAdministracion,
        comportamientoVolumenForzado: 'FIJO',
      },
    ],
    clasificaciones,
    contexto: { structureId: args.structureId, periodId },
  });
  const puntoEquilibrio = calcularPuntoEquilibrio(contribucionMarginal, new Date());
  const unidadGestion: UnidadGestion | null = company?.unidadGestion
    ? {
        codigo: company.unidadGestion.codigo,
        nombre: company.unidadGestion.nombre,
        factor: Number(company.unidadGestion.factor),
      }
    : null;
  const conversor = crearConversorUnidadGestion(unidadGestion);
  const unitCost = args.output.detail.unitCost;
  const outputEnUnidadGestion: CalculationOutput = {
    ...args.output,
    detail: {
      ...args.output.detail,
      unitCost: {
        ...unitCost,
        unitsProduced: conversor.cantidadDesdeBase(unitCost.unitsProduced),
        unitProductionCost: conversor.importeUnitarioDesdeBase(unitCost.unitProductionCost),
        unitFinishedGoodsCost: conversor.importeUnitarioDesdeBase(unitCost.unitFinishedGoodsCost),
        unitCostOfGoodsSold: conversor.importeUnitarioDesdeBase(unitCost.unitCostOfGoodsSold),
      },
    },
  };
  const contribucionEnUnidadGestion: ContribucionMarginal = contribucionMarginal.incompleta
    ? {
        ...contribucionMarginal,
        precioUnitario: conversor.importeUnitarioDesdeBase(contribucionMarginal.precioUnitario),
        unidadesVendidas: conversor.cantidadDesdeBase(contribucionMarginal.unidadesVendidas),
      }
    : {
        ...contribucionMarginal,
        precioUnitario: conversor.importeUnitarioDesdeBase(contribucionMarginal.precioUnitario),
        unidadesVendidas: conversor.cantidadDesdeBase(contribucionMarginal.unidadesVendidas),
        costoVariableUnitario: conversor.importeUnitarioDesdeBase(contribucionMarginal.costoVariableUnitario),
        contribucionMarginalUnitaria: conversor.importeUnitarioDesdeBase(contribucionMarginal.contribucionMarginalUnitaria),
      };
  const puntoEquilibrioEnUnidadGestion: PuntoEquilibrio = puntoEquilibrio.unidadesEquilibrio === null
    ? puntoEquilibrio
    : {
        ...puntoEquilibrio,
        unidadesEquilibrio: conversor.cantidadDesdeBase(puntoEquilibrio.unidadesEquilibrio),
      };

  const resultsBase = { ...args.output, incompletitud, contribucionMarginal, puntoEquilibrio };

  return {
    results: {
      ...outputEnUnidadGestion,
      incompletitud,
      contribucionMarginal: contribucionEnUnidadGestion,
      puntoEquilibrio: puntoEquilibrioEnUnidadGestion,
      unidadGestion,
    },
    resultsBase,
    incompletitud,
    periodId,
  };
}
