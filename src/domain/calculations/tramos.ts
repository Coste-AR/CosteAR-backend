import { Decimal } from 'decimal.js';

export type TipoTramoCosto = 'REEMPLAZA' | 'ACUMULA';

export interface TramoCostoCalculo {
  id: string;
  desde: number;
  hasta: number | null;
  tipo: TipoTramoCosto;
  importeFijo: number;
  cmUnitaria: number;
  /** Ausente significa que la empresa todavía no declaró un límite físico. */
  techoFisico: number | null;
}

export interface ResultadoTramoCosto {
  tramoId: string;
  tipo: TipoTramoCosto;
  desde: number;
  hasta: number | null;
  techo: number | null;
  qAritmetico: number | null;
  q: number | null;
  resultadoMaximo: number | null;
  motivoFueraDeTramo?: string;
}

export interface TransicionTramoCosto {
  desdeTramoId: string;
  haciaTramoId: string;
  qIndiferencia: number | null;
  binding: number | null;
  margenHastaTecho: number | null;
  porcentajeMargen: number | null;
  alertaPegadoAlTecho: boolean;
}

const numeroValido = (valor: number): boolean => Number.isFinite(valor);

/**
 * R29–R31. Resuelve cada tramo sin forzar un número fuera de su rango.
 *
 * REEMPLAZA aplica CF/cm a toda la actividad. ACUMULA conserva la contribución
 * obtenida en escalones previos y sólo aplica su cm a las unidades adicionales.
 * No redondea: la presentación decide la cantidad de decimales.
 */
export function calcularEquilibrioPorTramos(tramosEntrada: readonly TramoCostoCalculo[]): {
  tramos: ResultadoTramoCosto[];
  transiciones: TransicionTramoCosto[];
} {
  const tramos = [...tramosEntrada].sort((a, b) => a.desde - b.desde);
  let contribucionAcumulada = new Decimal(0);

  const resultados = tramos.map((tramo): ResultadoTramoCosto => {
    const techo = tramo.techoFisico ?? tramo.hasta;
    const entradasValidas = [tramo.desde, tramo.importeFijo, tramo.cmUnitaria]
      .every(numeroValido)
      && (tramo.hasta === null || numeroValido(tramo.hasta))
      && (tramo.techoFisico === null || numeroValido(tramo.techoFisico));
    if (!entradasValidas || tramo.cmUnitaria <= 0 || tramo.importeFijo < 0) {
      return {
        tramoId: tramo.id, tipo: tramo.tipo, desde: tramo.desde, hasta: tramo.hasta,
        techo, qAritmetico: null, q: null, resultadoMaximo: null,
        motivoFueraDeTramo: 'El tramo tiene parámetros inválidos o contribución marginal no positiva.',
      };
    }

    const cm = new Decimal(tramo.cmUnitaria);
    const fijo = new Decimal(tramo.importeFijo);
    const qAritmetico = tramo.tipo === 'REEMPLAZA'
      ? fijo.div(cm)
      : new Decimal(tramo.desde).plus(fijo.minus(contribucionAcumulada).div(cm));
    const limite = techo === null ? null : new Decimal(techo);
    const dentro = qAritmetico.greaterThanOrEqualTo(tramo.desde)
      && (limite === null || qAritmetico.lessThanOrEqualTo(limite));
    const resultadoMaximo = limite === null
      ? null
      : tramo.tipo === 'REEMPLAZA'
        ? limite.times(cm).minus(fijo)
        : contribucionAcumulada.plus(limite.minus(tramo.desde).times(cm)).minus(fijo);

    if (tramo.tipo === 'ACUMULA' && limite !== null) {
      contribucionAcumulada = contribucionAcumulada.plus(limite.minus(tramo.desde).times(cm));
    }

    return {
      tramoId: tramo.id,
      tipo: tramo.tipo,
      desde: tramo.desde,
      hasta: tramo.hasta,
      techo,
      qAritmetico: qAritmetico.toNumber(),
      q: dentro ? qAritmetico.toNumber() : null,
      resultadoMaximo: resultadoMaximo?.toNumber() ?? null,
      ...(!dentro ? {
        motivoFueraDeTramo: limite !== null && qAritmetico.greaterThan(limite)
          ? `El equilibrio aritmético supera el techo físico del tramo (${limite.toString()}).`
          : 'El equilibrio aritmético queda fuera del rango vigente del tramo.',
      } : {}),
    };
  });

  const transiciones = resultados.slice(0, -1).map((actual, indice): TransicionTramoCosto => {
    const siguiente = resultados[indice + 1]!;
    const siguienteEntrada = tramos[indice + 1]!;
    const qIndiferencia = actual.resultadoMaximo === null || siguienteEntrada.cmUnitaria <= 0
      ? null
      : new Decimal(actual.resultadoMaximo).plus(siguienteEntrada.importeFijo)
        .div(siguienteEntrada.cmUnitaria).toNumber();
    const binding = qIndiferencia === null
      ? siguiente.q
      : siguiente.q === null ? qIndiferencia : Math.max(qIndiferencia, siguiente.q);
    const margen = binding === null || siguiente.techo === null
      ? null : new Decimal(siguiente.techo).minus(binding).toNumber();
    const porcentaje = margen === null || siguiente.techo === null || siguiente.techo <= 0
      ? null : new Decimal(margen).div(siguiente.techo).times(100).toNumber();
    return {
      desdeTramoId: actual.tramoId,
      haciaTramoId: siguiente.tramoId,
      qIndiferencia,
      binding,
      margenHastaTecho: margen,
      porcentajeMargen: porcentaje,
      alertaPegadoAlTecho: porcentaje !== null && porcentaje >= 0 && porcentaje < 15,
    };
  });

  return { tramos: resultados, transiciones };
}
