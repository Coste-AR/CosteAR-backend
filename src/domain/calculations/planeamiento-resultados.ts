import { Decimal } from 'decimal.js';

export type ObjetivoPlaneamiento =
  | { tipo: 'resultado_absoluto'; importe: number }
  | { tipo: 'porcentaje_sobre_capital'; tasa: number; capitalFijo: number; capitalPorPesoCostoVariable: number };

type EntradaFisica = {
  modalidad: 'fisica';
  costosFijos: number;
  costoVariableUnitario: number;
  precioUnitario: number;
  unidadCantidad: string;
  moneda: string;
  objetivo: ObjetivoPlaneamiento;
};

type EntradaMonetaria = {
  modalidad: 'monetaria';
  costosFijos: number;
  margenMarcacion: number;
  moneda: string;
  objetivo: ObjetivoPlaneamiento;
};

export type EntradaPlaneamientoResultados = EntradaFisica | EntradaMonetaria;

export interface ResultadoPlaneamientoResultados {
  cantidadNecesaria: number | null;
  ventasNecesarias: number | null;
  resultadoLogrado: number | null;
  basadoEn: ObjetivoPlaneamiento['tipo'];
  unidades: { cantidadNecesaria: string | null; ventasNecesarias: string; resultadoLogrado: string };
  motivo?: string;
}

/** AM5 §5.8.3 y §5.8.5. No redondea resultados intermedios. */
export function calcularPlaneamientoResultados(input: EntradaPlaneamientoResultados): ResultadoPlaneamientoResultados {
  const d = (valor: number) => new Decimal(valor);
  const base = {
    cantidadNecesaria: null,
    ventasNecesarias: null,
    resultadoLogrado: null,
    basadoEn: input.objetivo.tipo,
    unidades: {
      cantidadNecesaria: input.modalidad === 'fisica' ? input.unidadCantidad : null,
      ventasNecesarias: input.moneda,
      resultadoLogrado: input.moneda,
    },
  } satisfies ResultadoPlaneamientoResultados;
  const ausente = (motivo: string): ResultadoPlaneamientoResultados => ({ ...base, motivo });

  if (input.modalidad === 'fisica') {
    const cm = d(input.precioUnitario).minus(input.costoVariableUnitario);
    const numerador = input.objetivo.tipo === 'resultado_absoluto'
      ? d(input.costosFijos).plus(input.objetivo.importe)
      : d(input.costosFijos)
        .plus(d(input.objetivo.tasa).times(input.objetivo.capitalFijo))
        .plus(d(input.objetivo.tasa).times(input.costosFijos));
    const denominador = input.objetivo.tipo === 'resultado_absoluto'
      ? cm
      : cm.minus(d(input.objetivo.tasa).times(input.objetivo.capitalPorPesoCostoVariable).times(input.costoVariableUnitario));
    if (!denominador.isFinite() || denominador.lte(0)) {
      return ausente('La contribución marginal disponible es cero o negativa; no existe un volumen que alcance el objetivo.');
    }
    const cantidad = numerador.div(denominador);
    const ventas = cantidad.times(input.precioUnitario);
    const resultado = cantidad.times(cm).minus(input.costosFijos);
    return { ...base, cantidadNecesaria: cantidad.toNumber(), ventasNecesarias: ventas.toNumber(), resultadoLogrado: resultado.toNumber() };
  }

  const margen = d(input.margenMarcacion);
  const tasa = input.objetivo.tipo === 'porcentaje_sobre_capital' ? d(input.objetivo.tasa) : d(0);
  const a = input.objetivo.tipo === 'porcentaje_sobre_capital' ? d(input.objetivo.capitalPorPesoCostoVariable) : d(0);
  const denominador = margen.minus(tasa.times(a));
  if (!denominador.isFinite() || denominador.lte(0) || margen.lte(0)) {
    return ausente('La contribución marginal disponible es cero o negativa; no existe un monto de ventas que alcance el objetivo.');
  }
  const objetivoFijo = input.objetivo.tipo === 'resultado_absoluto'
    ? d(input.objetivo.importe)
    : tasa.times(input.objetivo.capitalFijo).plus(tasa.times(input.costosFijos));
  const ventas = d(input.costosFijos).plus(objetivoFijo).times(margen.plus(1)).div(denominador);
  const resultado = ventas.times(margen).div(margen.plus(1)).minus(input.costosFijos);
  return { ...base, ventasNecesarias: ventas.toNumber(), resultadoLogrado: resultado.toNumber() };
}
