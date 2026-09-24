import { Decimal } from 'decimal.js';

export interface EntradaRelacionReemplazo {
  contribucionMarginalOrigen: number;
  contribucionMarginalDestino: number;
  cantidadOrigen: number;
  costoFijoDirectoOrigen: number;
  costoFijoDirectoDestino: number;
  costosFijosIndirectos: number;
  resultadoObjetivo: number;
  unidadCantidad: string;
}

export interface ResultadoRelacionReemplazo {
  relacionReemplazo: number | null;
  cantidadOrigen: number;
  cantidadDestino: number | null;
  resultadoCortoPlazo: number | null;
  resultadoLargoPlazo: number | null;
  unidades: {
    cantidadOrigen: string;
    cantidadDestino: string;
    resultadoCortoPlazo: string;
    resultadoLargoPlazo: string;
  };
  motivo?: string;
}

/**
 * Calcula la sustitución entre dos segmentos y expone juntos los dos horizontes:
 * en el corto plazo permanece el fijo directo del origen; en el largo se evita.
 */
export function calcularRelacionReemplazo(input: EntradaRelacionReemplazo): ResultadoRelacionReemplazo {
  const unidades = {
    cantidadOrigen: input.unidadCantidad,
    cantidadDestino: input.unidadCantidad,
    resultadoCortoPlazo: input.unidadCantidad,
    resultadoLargoPlazo: input.unidadCantidad,
  };
  const base = { cantidadOrigen: input.cantidadOrigen, unidades };
  const contribucionDestino = new Decimal(input.contribucionMarginalDestino);

  if (contribucionDestino.lte(0)) {
    return {
      ...base,
      relacionReemplazo: null,
      cantidadDestino: null,
      resultadoCortoPlazo: null,
      resultadoLargoPlazo: null,
      motivo: 'La contribución marginal del segmento destino debe ser positiva para calcular el reemplazo.',
    };
  }

  const relacion = new Decimal(input.contribucionMarginalOrigen).div(contribucionDestino);
  const resultadoComun = new Decimal(input.costoFijoDirectoDestino)
    .plus(input.costosFijosIndirectos)
    .plus(input.resultadoObjetivo);

  return {
    ...base,
    relacionReemplazo: relacion.toNumber(),
    cantidadDestino: relacion.times(input.cantidadOrigen).toNumber(),
    resultadoCortoPlazo: resultadoComun.plus(input.costoFijoDirectoOrigen).div(contribucionDestino).toNumber(),
    resultadoLargoPlazo: resultadoComun.div(contribucionDestino).toNumber(),
  };
}
