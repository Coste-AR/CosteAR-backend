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
  const [pending, periodoDelFallback, company] = await Promise.all([
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
    // `orderBy` explícito porque una estructura PUEDE tener más de un período
    // abierto: `CostPeriodService.reopen()` reabre uno cerrado sin comprobar que
    // no haya otro OPEN, y el schema no lo impide. Sin orden, la base elegía
    // cualquiera. Se ordena igual que `CostPeriodService.getOpen()`.
    args.periodId
      ? Promise.resolve(null)
      : db.costPeriod.findFirst({
          where: { structureId: args.structureId, status: 'OPEN', deletedAt: null },
          select: { id: true },
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
  const periodId = args.periodId ?? periodoDelFallback?.id ?? null;

  // M0-01. Cuatro renglones del costo REAL (#90, #116, #92) que hasta acá
  // nunca llegaban al costeo variable: variación presupuesto, trabajos de
  // terceros, amortización de activos, y el neto de desperdicio (recupero +
  // merma extraordinaria, ambos RESTAN del costo — ver `cost-statement.ts`).
  //
  // Los cuatro son OPCIONALES en `CalculationOutput` por retrocompatibilidad
  // con corridas guardadas antes de que existieran (#90/#92/#116). En la
  // práctica `runCalculation()` siempre los completa —`calcCostStatement`
  // los defaultea a cero internamente—, así que acá adentro nunca deberían
  // faltar; el chequeo es defensivo. Si alguna vez faltan, NO se computan
  // como cero (afirmaría una medición que no se hizo): se omiten del
  // control de suma y el faltante queda en `incompletitud`, visible aparte
  // de la clasificación de cada componente.
  const rubrosAusentes: string[] = [];
  const componenteOpcional = (
    valor: number | undefined,
    clave: string,
    etiqueta: string,
    motivoAusencia: string,
  ) => {
    if (valor === undefined) {
      rubrosAusentes.push(motivoAusencia);
      return [];
    }
    return [{ clave, etiqueta, importeAbsorcion: valor }];
  };
  const desperdicioAlCosto = args.output.desperdicio === undefined
    ? undefined
    // `|| 0` normaliza el -0 que da `-(0 + 0)` en IEEE 754: sin recupero ni
    // merma extraordinaria el componente es cero, no "menos cero" — un
    // detalle invisible en memoria que un `results` persistido como JSON
    // delata (Postgres normaliza -0 a 0 al volver, y entonces el snapshot
    // deja de coincidir bit a bit con lo que se acaba de calcular).
    : -(args.output.desperdicio.recuperoAplicado + args.output.desperdicio.alResultado) || 0;

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
  const componentes = [
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
    ...componenteOpcional(
      args.output.budgetVariance,
      CLAVES_COMPORTAMIENTO_CONTRIBUCION.variacionPresupuesto,
      'Variación presupuesto',
      'Este cálculo es anterior a que se midiera la variación presupuesto: no entra al costeo variable.',
    ),
    ...componenteOpcional(
      args.output.thirdPartyWork,
      CLAVES_COMPORTAMIENTO_CONTRIBUCION.trabajosDeTerceros,
      'Trabajos de terceros',
      'Este cálculo es anterior a que se midieran los trabajos de terceros: no entran al costeo variable.',
    ),
    ...componenteOpcional(
      args.output.assetDepreciation,
      CLAVES_COMPORTAMIENTO_CONTRIBUCION.amortizacionActivos,
      'Amortización de activos',
      'Este cálculo es anterior a que se midiera la amortización de activos: no entra al costeo variable.',
    ),
    ...componenteOpcional(
      desperdicioAlCosto,
      CLAVES_COMPORTAMIENTO_CONTRIBUCION.desperdicioAlCosto,
      'Desperdicio (neto de recupero y merma extraordinaria)',
      'Este cálculo es anterior a que se midiera el desperdicio: no entra al costeo variable.',
    ),
  ];
  const incompletitud = buildIncompletitud(pending);
  if (rubrosAusentes.length > 0) {
    incompletitud.incompleto = true;
    incompletitud.motivos.push(...rubrosAusentes);
  }
  const contribucionMarginal = calcularContribucionMarginal({
    precioUnitario: args.input.sales.unitPrice,
    unidadesVendidas: args.input.sales.quantity,
    componentes,
    clasificaciones,
    contexto: { structureId: args.structureId, periodId },
    // Control de suma (M0-01): solo se aplica si TODOS los componentes
    // llegaron — con alguno ausente ya no hay nada contra qué reconciliar.
    totalEsperado: rubrosAusentes.length === 0 ? args.output.netProductionCost : undefined,
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
