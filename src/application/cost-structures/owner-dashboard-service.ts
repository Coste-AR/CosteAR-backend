import type { PrismaClient } from '@prisma/client';
import { prisma, withTenant } from '../../infrastructure/database/prisma.js';
import { NotFoundError } from '../../domain/errors/domain-error.js';
import {
  crearConversorUnidadGestion,
  type UnidadGestion,
} from '../../domain/units/unidad-gestion.js';
import { PaqueteRubroService } from '../operacion/paquete-rubro-service.js';

type ParametroSinConfirmar = {
  id: string;
  nombre: string;
};

type NumeroTablero = {
  valor: number | null;
  completo: boolean;
  parametrosSinConfirmar: boolean;
  parametrosSinConfirmarDetalle: ParametroSinConfirmar[];
  motivos: string[];
};

/**
 * `diferenciaPorVariacionDeInventarios` (M0-03) lleva, además del importe, una
 * frase en castellano que explica de dónde sale — no alcanza con el número: es
 * la brecha entre dos vistas del mismo período, y sin texto nadie sabe si es un
 * error o algo esperado. `null` cuando está incompleta o cuando da $0 (con
 * producción = venta no hay nada que explicar).
 */
type NumeroTableroConExplicacion = NumeroTablero & { explicacion: string | null };

/**
 * `costoPorCajon.fijo` es un COSTO FIJO UNITARIO: `AM4` (bóveda) lo llama "una
 * entidad inexistente en la realidad… establece una comparación entre dos
 * magnitudes absolutamente independientes entre sí". Regla dura R10: los
 * fijos se controlan en TOTALES, no por unidad. Se conserva en el contrato
 * (hay consumidores) pero marcado, para que quien lo lea sepa que no es una
 * magnitud económica y baje su jerarquía visual (MX-02).
 */
type NumeroTableroFijo = NumeroTablero & { esUnitarioDeFijo: true };

type AreaPendienteCierre = 'calculo' | 'imputacion' | 'configuracion' | 'produccion' | 'ventas' | 'costeo';

type PendienteCierre = {
  area: AreaPendienteCierre;
  dato: string;
  periodo: { id: string; codigo: string };
};

type FuentePendiente = Omit<PendienteCierre, 'periodo'>;

type ResultadoCorrida = {
  grossMargin?: number;
  incompletitud?: { incompleto?: boolean; motivos?: string[]; datosPendientes?: Array<{ id: string; nombre: string }> };
  detail?: { unitCost?: { unitFinishedGoodsCost?: number; basadoEn?: 'producidas' | 'vendidas' } };
  contribucionMarginal?: {
    incompleta: boolean;
    precioUnitario: number;
    unidadesVendidas: number;
    costoVariableUnitario: number | null;
    contribucionMarginalUnitaria: number | null;
    componentes: Array<{
      etiqueta: string;
      importeAbsorcion: number;
      comportamientoVolumen: string | null;
      parametroId: string | null;
      conceptoId?: string | null;
      porcionFijaSemifija?: number | null;
      porcionVariableSemifija?: number | null;
    }>;
    motivos?: string[];
  };
  puntoEquilibrio?: {
    incompleta: boolean;
    unidadesEquilibrio: number | null;
    fechaUltimoRecalculo: string;
    motivos?: string[];
    motivoSinEquilibrio?: string;
  };
};

// Varios indicadores pueden depender del mismo dato; el tablero ofrece la acción una sola vez.
const pendientesUnicos = (
  periodo: { id: string; codigo: string },
  fuentes: FuentePendiente[],
): PendienteCierre[] => {
  const vistos = new Set<string>();
  return fuentes.flatMap((fuente) => {
    const clave = `${fuente.area}:${fuente.dato}`;
    if (vistos.has(clave)) return [];
    vistos.add(clave);
    return [{ ...fuente, periodo }];
  });
};

const incompleto = (motivos: string[], parametrosSinConfirmarDetalle: ParametroSinConfirmar[] = []): NumeroTablero => ({
  valor: null,
  completo: false,
  parametrosSinConfirmar: parametrosSinConfirmarDetalle.length > 0,
  parametrosSinConfirmarDetalle,
  motivos,
});

const completo = (valor: number, parametrosSinConfirmarDetalle: ParametroSinConfirmar[] = [], motivos: string[] = []): NumeroTablero => ({
  valor,
  completo: motivos.length === 0,
  parametrosSinConfirmar: parametrosSinConfirmarDetalle.length > 0,
  parametrosSinConfirmarDetalle,
  motivos,
});

const ADVERTENCIA_FIJO_UNITARIO =
  'El "costo fijo por cajón" no es una magnitud económica: compara un total fijo contra una ' +
  'cantidad que no lo originó. Se mantiene por compatibilidad; para controlar los fijos usá ' +
  '«costosFijosDelPeriodo» (el total) y para saber qué volumen los cubre, «cajonesQueTapanLosFijos».';

const marcarComoUnitarioDeFijo = (numero: NumeroTablero): NumeroTableroFijo => ({
  ...numero,
  esUnitarioDeFijo: true,
  motivos: numero.completo ? [ADVERTENCIA_FIJO_UNITARIO, ...numero.motivos] : numero.motivos,
});

/**
 * Compone los seis indicadores del tablero sin recalcularlos. Lee una foto de
 * CalculationRun del período y transforma solamente las unidades internas a la
 * unidad de gestión que la empresa declaró (`Company.unidadGestionId`, #274).
 * Sin esa declaración no hay a qué unidad convertir: los indicadores por unidad
 * quedan incompletos y la respuesta lo dice con `unidadGestion: null`, nunca con
 * un default inventado (#252).
 */
export class OwnerDashboardService {
  constructor(private readonly db: PrismaClient = prisma) {}

  async get(userId: string, periodId: string) {
    const period = await withTenant(userId, (tx) => tx.costPeriod.findFirst({
      where: { id: periodId, userId, deletedAt: null },
      select: { id: true, code: true, companyId: true, productionQuantity: true, salesQuantity: true },
    }));
    if (!period) throw new NotFoundError('Período de costos no encontrado');

    const [run, company] = await Promise.all([
      withTenant(userId, (tx) => tx.calculationRun.findFirst({
        where: { periodId }, orderBy: [{ validated: 'desc' }, { executedAt: 'desc' }],
        select: { id: true, validated: true, executedAt: true, results: true },
      })),
      withTenant(userId, (tx) => tx.company.findFirst({
        where: { id: period.companyId },
        select: {
          unidadGestion: { select: { codigo: true, nombre: true, factor: true } },
          paquetesRubro: { select: { category: true } },
        },
      })),
    ]);
    const unidadGestion: UnidadGestion | null = company?.unidadGestion
      ? { codigo: company.unidadGestion.codigo, nombre: company.unidadGestion.nombre, factor: Number(company.unidadGestion.factor) }
      : null;
    const categoriasRubro = [...new Set(company?.paquetesRubro?.map((paquete) => paquete.category) ?? [])];
    const categoriaRubro = categoriasRubro.length === 1 ? categoriasRubro[0]! : null;
    const paqueteRubro = categoriaRubro
      ? await new PaqueteRubroService(this.db).resolve(userId, categoriaRubro, { companyId: period.companyId })
      : null;
    const rubro = paqueteRubro
      ? { clave: paqueteRubro.category, icons: paqueteRubro.icons as Record<string, string> }
      : null;
    const pendienteRubro: FuentePendiente[] = rubro === null
      ? [{ area: 'configuracion', dato: 'La empresa no tiene un paquete de rubro declarado' }]
      : [];
    const conversor = crearConversorUnidadGestion(unidadGestion);

    const sinCorrida = ['No hay una corrida de cálculo para este período.'];
    if (!run) {
      const falta = incompleto(sinCorrida);
      const periodo = { id: period.id, codigo: period.code };
      return {
        periodo, corrida: null, unidadGestion, rubro,
        pendientes: pendientesUnicos(periodo, [
          { area: 'calculo', dato: 'corrida de cálculo' },
          ...pendienteRubro,
        ]),
        costoPorCajon: { variable: falta, fijo: marcarComoUnitarioDeFijo(falta), total: falta },
        costosFijosDelPeriodo: falta,
        cajonesQueTapanLosFijos: falta,
        precioPromedioVenta: falta, contribucionMarginalPorCajon: falta,
        puntoEquilibrioCajones: { ...falta, fechaUltimoRecalculo: null },
        producidoCajones: falta, resultadoPeriodo: falta,
        resultadoPeriodoCosteoVariable: falta,
        diferenciaPorVariacionDeInventarios: { ...falta, explicacion: null },
      };
    }

    const resultado = run.results as ResultadoCorrida;
    const periodo = { id: period.id, codigo: period.code };
    const contribucion = resultado.contribucionMarginal;
    const equilibrio = resultado.puntoEquilibrio;
    const unidadesEquilibrio = equilibrio?.unidadesEquilibrio ?? null;
    const factor = unidadGestion ? unidadGestion.factor : null;
    const motivosBase = resultado.incompletitud?.incompleto ? (resultado.incompletitud.motivos ?? []) : [];
    const datosPendientesBase = resultado.incompletitud?.datosPendientes ?? [];
    const idsParametros = contribucion?.componentes.map((c) => c.parametroId).filter((id): id is string => id !== null) ?? [];
    const idsConceptos = contribucion?.componentes
      .map((c) => c.conceptoId)
      .filter((id): id is string => id != null) ?? [];
    const parametrosSinConfirmar = idsParametros.length > 0 || idsConceptos.length > 0
      ? await withTenant(userId, async (tx) => {
          const [parametros, conceptos] = await Promise.all([
            idsParametros.length > 0
              ? tx.parametroCosteo.findMany({
                  where: { id: { in: idsParametros }, confirmado: false, deletedAt: null },
                  select: { id: true, clave: true, descripcion: true },
                  orderBy: [{ clave: 'asc' }, { id: 'asc' }],
                })
              : [],
            idsConceptos.length > 0
              ? tx.conceptoCosteo.findMany({
                  where: { id: { in: idsConceptos }, confirmado: false, deletedAt: null },
                  select: { id: true, clave: true, descripcion: true },
                  orderBy: [{ clave: 'asc' }, { id: 'asc' }],
                })
              : [],
          ]);
          return [...parametros, ...conceptos].map((parametro) => ({
            id: parametro.id,
            nombre: parametro.descripcion?.trim() || parametro.clave,
          }));
        })
      : [];
    const sinUnidad = factor === null ? ['La empresa no tiene declarada su unidad de gestión.'] : [];
    const baseUnidades = Number(period.productionQuantity ?? 0);
    const sinProduccion = baseUnidades <= 0 ? ['Falta cargar una cantidad producida mayor a cero para el período.'] : [];
    const sinVentas = !contribucion || contribucion.unidadesVendidas <= 0
      ? ['Falta cargar ventas del período para obtener este indicador.']
      : [];
    const pendientesBase = datosPendientesBase.length > 0
      ? datosPendientesBase.map(({ nombre }) => ({ area: 'imputacion' as const, dato: nombre }))
      : motivosBase.map((motivo) => ({ area: 'imputacion' as const, dato: motivo }));
    const pendientesClasificacion = contribucion?.componentes.flatMap((componente) => {
      if (componente.comportamientoVolumen === null) {
        return [{ area: 'costeo' as const, dato: `clasificación frente al volumen del rubro ${componente.etiqueta}` }];
      }
      if (componente.comportamientoVolumen === 'SEMIFIJO') {
        return componente.porcionVariableSemifija == null
          ? [{ area: 'costeo' as const, dato: `tramo variable del rubro ${componente.etiqueta}` }]
          : [];
      }
      return [];
    }) ?? [];
    const pendientes = pendientesUnicos(periodo, [
      ...pendientesBase,
      ...(factor === null ? [{ area: 'configuracion' as const, dato: 'unidad de gestión de la empresa' }] : []),
      ...pendienteRubro,
      ...(baseUnidades <= 0 ? [{ area: 'produccion' as const, dato: 'cantidad producida mayor a cero' }] : []),
      ...(sinVentas.length > 0 ? [{ area: 'ventas' as const, dato: 'ventas del período' }] : []),
      ...pendientesClasificacion,
      ...(equilibrio?.motivoSinEquilibrio ? [{ area: 'costeo' as const, dato: 'contribución marginal unitaria positiva' }] : []),
      ...(!contribucion || resultado.detail?.unitCost?.unitFinishedGoodsCost == null
        ? [{ area: 'costeo' as const, dato: 'resultado de costos de la corrida' }]
        : []),
    ]);
    const costosBase = [...motivosBase, ...sinUnidad, ...sinProduccion];
    const sinDatosDeCorrida = !contribucion || factor === null || baseUnidades <= 0 || resultado.detail?.unitCost?.unitFinishedGoodsCost == null;
    const costosMotivosPorFalta = costosBase.length > 0 ? costosBase : ['Falta el resultado de costos de la corrida.'];
    // Con la clasificación incompleta los tres indicadores de esta fila salen
    // incompletos, no solo `variable` (MX-03).
    //
    // Antes `fijo` llamaba a `completo(...)` sin mirar la incompletitud: sumaba
    // ÚNICAMENTE los componentes que sí se habían clasificado como FIJO y
    // publicaba ese subtotal como si fuera el costo fijo del período. El rubro
    // sin clasificar desaparecía del número sin dejar rastro — un dato parcial
    // presentado como completo, que es peor que un dato faltante: el dueño no
    // tiene manera de saber que le falta plata adentro.
    //
    // `total` también, aunque salga del motor y no dependa de la clasificación:
    // los tres se leen como una descomposición (`variable + fijo = total`), y un
    // total exacto al lado de dos partes desconocidas invita a deducir la que
    // falta restando. Es la precisión falsa que R13 prohíbe.
    //
    // La ZONA de equilibrio que R13 pide en lugar del punto llega en M1-03; acá
    // el alcance es solamente dejar de mentir.
    const motivosContribucion = [...motivosBase, ...(contribucion?.motivos ?? [])];
    const clasificacionIncompleta = !sinDatosDeCorrida && contribucion!.costoVariableUnitario === null;
    // Total de componentes FIJO, SIN dividir por unidades — la magnitud que R10
    // exige para controlar fijos (MX-02). A diferencia de `costoPorCajon.fijo`,
    // es un importe en pesos: no depende de la unidad de gestión, así que no
    // pasa por `conversor.importeUnitarioDesdeBase` (eso convierte precios POR
    // unidad). Solo tiene sentido cuando la clasificación cerró: con algún
    // rubro sin clasificar, el total FIJO también es parcial (mismo motivo que
    // MX-03), así que viaja incompleto igual que el resto de la fila.
    const totalFijoBase: number | null = sinDatosDeCorrida || clasificacionIncompleta
      ? null
      : contribucion!.componentes
          .filter((c) => c.comportamientoVolumen === 'FIJO' || c.comportamientoVolumen === 'SEMIFIJO')
          .reduce(
            (sum, c) => sum + (c.comportamientoVolumen === 'SEMIFIJO'
              ? (c.porcionFijaSemifija ?? 0)
              : c.importeAbsorcion),
            0,
          );
    const costos = sinDatosDeCorrida
      ? { variable: incompleto(costosMotivosPorFalta, parametrosSinConfirmar), fijo: marcarComoUnitarioDeFijo(incompleto(costosMotivosPorFalta, parametrosSinConfirmar)), total: incompleto(costosMotivosPorFalta, parametrosSinConfirmar) }
      : clasificacionIncompleta
        ? {
            variable: incompleto(motivosContribucion, parametrosSinConfirmar),
            fijo: marcarComoUnitarioDeFijo(incompleto(motivosContribucion, parametrosSinConfirmar)),
            total: incompleto(motivosContribucion, parametrosSinConfirmar),
          }
        : {
            variable: completo(conversor.importeUnitarioDesdeBase(contribucion!.costoVariableUnitario!), parametrosSinConfirmar, motivosBase),
            fijo: marcarComoUnitarioDeFijo(
              completo(conversor.importeUnitarioDesdeBase(totalFijoBase! / baseUnidades), parametrosSinConfirmar, motivosBase),
            ),
            total: completo(conversor.importeUnitarioDesdeBase(resultado.detail!.unitCost!.unitFinishedGoodsCost!), parametrosSinConfirmar, motivosBase),
          };

    const convertido = (numero: number | null, motivos: string[]): NumeroTablero =>
      numero === null || factor === null || motivos.length > 0
        ? incompleto([...motivos, ...sinUnidad], parametrosSinConfirmar)
        : completo(conversor.importeUnitarioDesdeBase(numero), parametrosSinConfirmar);

    const contribucionMarginalPorCajonCalculada = convertido(
      contribucion?.incompleta ? null : (contribucion?.contribucionMarginalUnitaria ?? null),
      [...motivosBase, ...sinVentas, ...(contribucion?.motivos ?? [])],
    );
    // Es la pregunta real que alguien hace cuando mira un fijo "por cajón":
    // no "cuánto fijo carga cada cajón" (R10 lo prohíbe), sino "cuántos cajones
    // hay que vender para cubrir el fijo total" — CF / cm, igual que MX-01.
    // Con CM <= 0 ningún volumen alcanza: cada cajón vendido agranda la
    // pérdida, así que sale incompleto con motivo, nunca un infinito.
    const cmValor = contribucionMarginalPorCajonCalculada.completo ? contribucionMarginalPorCajonCalculada.valor : null;
    const sinCMPositiva = cmValor !== null && cmValor <= 0
      ? ['La contribución marginal no es positiva: ningún volumen de ventas cubre los costos fijos.']
      : [];
    const cajonesQueTapanLosFijos: NumeroTablero =
      totalFijoBase === null || cmValor === null || cmValor <= 0
        ? incompleto(
            [
              ...(totalFijoBase === null ? costosMotivosPorFalta : []),
              ...contribucionMarginalPorCajonCalculada.motivos,
              ...sinCMPositiva,
            ],
            parametrosSinConfirmar,
          )
        : completo(totalFijoBase / cmValor, parametrosSinConfirmar, motivosBase);

    /**
     * M0-03. El tablero se presenta como la vista de costeo VARIABLE del
     * negocio, pero su cifra de cierre (`resultado.grossMargin`) es de
     * ABSORCIÓN. Coinciden solo cuando se vende todo lo producido — `AM4` nota
     * CosteAR: "el costeo por absorción es una vista de salida para cumplir la
     * RT 17; el motor razona en costeo variable, y la derivación es
     * unidireccional". Ninguna de las dos se esconde (RT 17 exige que la de
     * absorción exista igual): se agrega la variable al lado, no en su lugar.
     *
     * Fórmula: ventas − cv de lo vendido − fijos del período. Como
     * `contribucionMarginalUnitaria = precio − cv`, eso es exactamente
     * `cm × vendidas − fijos` — no hace falta separar el cv de producción del
     * de comercialización (eso es M0-02/M2-01) para llegar a este número: la
     * separación importaría para DESGLOSAR el cv, no para el resultado total.
     */
    const resultadoPeriodoCosteoVariable: NumeroTablero = sinDatosDeCorrida
      ? incompleto(costosMotivosPorFalta, parametrosSinConfirmar)
      : clasificacionIncompleta
        ? incompleto(motivosContribucion, parametrosSinConfirmar)
        : completo(
            contribucion!.contribucionMarginalUnitaria! * contribucion!.unidadesVendidas - totalFijoBase!,
            parametrosSinConfirmar,
            motivosBase,
          );
    const resultadoPeriodoField: NumeroTablero = resultado.grossMargin == null || sinVentas.length > 0
      ? incompleto([...motivosBase, ...sinVentas], parametrosSinConfirmar)
      : completo(resultado.grossMargin, parametrosSinConfirmar, motivosBase);
    const diferenciaPorVariacionDeInventarios: NumeroTableroConExplicacion =
      resultadoPeriodoField.completo && resultadoPeriodoCosteoVariable.completo
        ? (() => {
            const diferencia = resultadoPeriodoField.valor! - resultadoPeriodoCosteoVariable.valor!;
            const unidadesProducidas = baseUnidades;
            const unidadesVendidas = contribucion!.unidadesVendidas;
            const explicacion = Math.abs(diferencia) < 0.01
              ? null
              : unidadesProducidas > unidadesVendidas
                ? `La producción (${unidadesProducidas}) superó a la venta (${unidadesVendidas}): parte del costo fijo del período quedó en el inventario final y todavía no impactó en el resultado por costeo variable — por eso el de absorción da más alto.`
                : `La venta (${unidadesVendidas}) superó a la producción (${unidadesProducidas}): el costeo variable ya reconoce el costo fijo del período completo, mientras que el de absorción incluye además el que traía el inventario inicial — por eso da más bajo.`;
            return { ...completo(diferencia, [], []), explicacion };
          })()
        : {
            ...incompleto([...resultadoPeriodoField.motivos, ...resultadoPeriodoCosteoVariable.motivos], parametrosSinConfirmar),
            explicacion: null,
          };

    return {
      periodo,
      corrida: { id: run.id, validada: run.validated, ejecutadaEn: run.executedAt.toISOString() },
      unidadGestion,
      rubro,
      pendientes,
      costoPorCajon: costos,
      costosFijosDelPeriodo: totalFijoBase === null
        ? incompleto(costosMotivosPorFalta, parametrosSinConfirmar)
        : completo(totalFijoBase, parametrosSinConfirmar, motivosBase),
      cajonesQueTapanLosFijos,
      precioPromedioVenta: convertido(contribucion?.precioUnitario ?? null, [...motivosBase, ...sinVentas]),
      contribucionMarginalPorCajon: contribucionMarginalPorCajonCalculada,
      puntoEquilibrioCajones: {
        ...(equilibrio?.incompleta || unidadesEquilibrio === null || factor === null
          ? incompleto([...motivosBase, ...(equilibrio?.motivos ?? []), ...(equilibrio?.motivoSinEquilibrio ? [equilibrio.motivoSinEquilibrio] : []), ...sinUnidad], parametrosSinConfirmar)
          : completo(conversor.cantidadDesdeBase(unidadesEquilibrio), parametrosSinConfirmar, motivosBase)),
        fechaUltimoRecalculo: equilibrio?.fechaUltimoRecalculo ?? null,
      },
      producidoCajones: factor === null || baseUnidades <= 0
        ? incompleto([...sinProduccion, ...sinUnidad])
        : completo(conversor.cantidadDesdeBase(baseUnidades)),
      // "resultado por costeo completo (absorción)" — se conserva íntegro
      // (RT 17), la cifra destacada del tablero es `resultadoPeriodoCosteoVariable`.
      resultadoPeriodo: resultadoPeriodoField,
      resultadoPeriodoCosteoVariable,
      diferenciaPorVariacionDeInventarios,
    };
  }
}
