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
  const periodId = args.periodId ?? periodoResuelto?.id ?? null;
  const gastosDeNoFabricacion = {
    gastoVariableComercializacionPorUnidad: Number(periodoResuelto?.gastoVariableComercializacionPorUnidad ?? 0),
    gastoFijoAdministracion: Number(periodoResuelto?.gastoFijoAdministracion ?? 0),
  };

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
  const [parametros, conceptosSemifijos] = args.companyId
    ? await Promise.all([
        db.parametroCosteo.findMany({
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
        }),
        db.conceptoCosteo.findMany({
          where: {
            companyId: args.companyId,
            deletedAt: null,
            comportamientoVolumen: 'SEMIFIJO',
          },
          include: {
            tramosSemifijos: {
              where: { deletedAt: null },
              orderBy: { createdAt: 'desc' },
              take: 1,
            },
          },
          orderBy: { clasificadoEn: 'desc' },
        }),
      ])
    : [[], []];

  // M1-02. `ConceptoCosteo` vive por debajo de los baldes históricos. Mientras
  // el motor conserva un único importe por elemento, una separación puede
  // reemplazar al balde solo cuando hay UN concepto semifijo resuelto para ese
  // elemento. Con dos o más, no se inventa cómo repartir el total agregado: se
  // conserva la clasificación del balde y el tablero sigue marcando la falta.
  const porClave = new Map<string, typeof conceptosSemifijos>();
  for (const concepto of conceptosSemifijos) {
    const existentes = porClave.get(concepto.clave) ?? [];
    existentes.push(concepto);
    porClave.set(concepto.clave, existentes);
  }
  const resueltos = [...porClave.values()].flatMap((candidatos) => {
    const porPeriodo = periodId
      ? candidatos.find((c) => c.periodId === periodId)
      : undefined;
    const porEstructura = candidatos.find(
      (c) => c.periodId === null && c.structureId === args.structureId,
    );
    const porEmpresa = candidatos.find(
      (c) => c.periodId === null && c.structureId === null,
    );
    const resuelto = porPeriodo ?? porEstructura ?? porEmpresa;
    return resuelto ? [resuelto] : [];
  });
  const clavePorElemento: Partial<Record<string, string>> = {
    MP: CLAVES_COMPORTAMIENTO_CONTRIBUCION.materiaPrima,
    MOD: CLAVES_COMPORTAMIENTO_CONTRIBUCION.manoObraDirecta,
    CIP: CLAVES_COMPORTAMIENTO_CONTRIBUCION.costosIndirectos,
  };
  const conceptosSinteticos: FilaComportamiento[] = [];
  for (const elemento of ['MP', 'MOD', 'CIP'] as const) {
    const delElemento = resueltos.filter((c) => c.elemento === elemento);
    if (delElemento.length !== 1) continue;
    const concepto = delElemento[0]!;
    const tramo = concepto.tramosSemifijos[0];
    if (!tramo) continue;
    const clave = clavePorElemento[elemento];
    if (!clave) continue;
    conceptosSinteticos.push({
      id: concepto.id,
      clave,
      comportamientoVolumen: 'SEMIFIJO',
      structureId: concepto.structureId,
      periodId: concepto.periodId,
      clasificadoPorUserId: concepto.clasificadoPorUserId,
      clasificadoEn: concepto.clasificadoEn,
      fuente: 'concepto',
      porcionFijaSemifija: Number(tramo.porcionFija),
      porcionVariableSemifija: Number(tramo.porcionVariable),
      metodoSemifijo: tramo.metodo,
      observacionesBaseSemifija: Array.isArray(tramo.observacionesBase)
        ? tramo.observacionesBase as Array<{ volumen: number; importe: number }>
        : [],
    });
  }
  const clasificaciones: FilaComportamiento[] = [
    ...conceptosSinteticos,
    ...parametros.map((parametro) => ({ ...parametro, fuente: 'parametro' as const })),
  ];
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
    // M2-01. Forzados: no pasan por la cascada de ParametroCosteo (ver el
    // comentario de comportamientoVolumenForzado en el dominio). A diferencia
    // de los `componenteOpcional` de arriba, siempre están presentes (el
    // período los trae en 0 por default, nunca undefined).
    {
      clave: CLAVES_COMPORTAMIENTO_CONTRIBUCION.gastosComercializacion,
      etiqueta: 'Gastos de comercialización',
      importeAbsorcion: gastosDeNoFabricacion.gastoVariableComercializacionPorUnidad * args.input.sales.quantity,
      comportamientoVolumenForzado: 'VARIABLE' as const,
      // M0-02: elemento 'venta' — divide por VENDIDAS, no por producidas.
      elemento: 'venta' as const,
    },
    {
      clave: CLAVES_COMPORTAMIENTO_CONTRIBUCION.gastosAdministracion,
      etiqueta: 'Gastos de administración',
      importeAbsorcion: gastosDeNoFabricacion.gastoFijoAdministracion,
      comportamientoVolumenForzado: 'FIJO' as const,
      // Fijo: no participa de ningún divisor, pero 'venta' documenta su origen.
      elemento: 'venta' as const,
    },
  ];
  const incompletitud = buildIncompletitud(pending);
  if (rubrosAusentes.length > 0) {
    incompletitud.incompleto = true;
    incompletitud.motivos.push(...rubrosAusentes);
  }
  const contribucionMarginal = calcularContribucionMarginal({
    precioUnitario: args.input.sales.unitPrice,
    unidadesVendidas: args.input.sales.quantity,
    // M0-02: el costo variable de producción divide por PRODUCIDAS. Mismo
    // dato que ya usa `detail.unitCost` del motor auditado — no es un valor
    // nuevo, es que esta capa no lo recibía.
    unidadesProducidas: args.input.sales.productionQuantity,
    componentes,
    clasificaciones,
    contexto: { structureId: args.structureId, periodId },
    // Control de suma (M0-01): solo se aplica si TODOS los componentes
    // llegaron — con alguno ausente ya no hay nada contra qué reconciliar.
    // M2-01: comercialización/administración SIEMPRE están (el período los
    // trae en 0 por default, no opcionales), así que siempre suman al total
    // esperado — a diferencia de los 4 de M0-01, no tienen su propio "si
    // faltan, no reconciliar".
    totalEsperado: rubrosAusentes.length === 0 && args.output.netProductionCost !== undefined
      ? args.output.netProductionCost
        + gastosDeNoFabricacion.gastoFijoAdministracion
        + gastosDeNoFabricacion.gastoVariableComercializacionPorUnidad * args.input.sales.quantity
      : undefined,
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
