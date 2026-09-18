import { Decimal } from 'decimal.js';
import { UnprocessableEntityError } from '../errors/domain-error.js';

export type MetodoTramoSemifijo =
  | 'PUNTOS_EXTREMOS'
  | 'CORRELACION'
  | 'DISPERSION_GRAFICA'
  | 'DECLARADO';

export interface ObservacionSemifija {
  volumen: number;
  importe: number;
}

export interface SepararTramoSemifijoInput {
  importe: number;
  metodo: MetodoTramoSemifijo;
  observacionesBase?: ObservacionSemifija[];
  porcionFija?: number;
  porcionVariable?: number;
}

export interface SeparacionTramoSemifijo {
  importe: number;
  porcionFija: number;
  porcionVariable: number;
  metodo: MetodoTramoSemifijo;
  observacionesBase: ObservacionSemifija[];
  costoVariableUnitario: number | null;
  coeficienteCorrelacion: number | null;
}

const A_CENTAVOS = new Decimal(0.01);

function error(message: string, field: string): never {
  throw new UnprocessableEntityError(message, { field });
}

function validarObservaciones(observaciones: ObservacionSemifija[], minimo: number): void {
  if (observaciones.length < minimo) {
    error(`El método necesita al menos ${minimo} observaciones de volumen e importe.`, 'observacionesBase');
  }
  for (const observacion of observaciones) {
    if (!Number.isFinite(observacion.volumen) || observacion.volumen < 0) {
      error('Cada volumen observado tiene que ser un número mayor o igual a cero.', 'observacionesBase');
    }
    if (!Number.isFinite(observacion.importe) || observacion.importe < 0) {
      error('Cada importe observado tiene que ser un número mayor o igual a cero.', 'observacionesBase');
    }
  }
  if (new Set(observaciones.map((o) => o.volumen)).size < 2) {
    error('Las observaciones tienen que incluir al menos dos volúmenes distintos.', 'observacionesBase');
  }
}

function validarPartes(importe: Decimal, fija: Decimal, variable: Decimal): void {
  if (fija.isNegative() || variable.isNegative()) {
    error('Las porciones fija y variable no pueden ser negativas.', 'porcionFija');
  }
  const diferencia = fija.plus(variable).minus(importe).abs();
  if (diferencia.greaterThanOrEqualTo(A_CENTAVOS)) {
    error(
      `La porción fija (${fija.toFixed(2)}) más la variable (${variable.toFixed(2)}) ` +
        `tiene que ser igual al importe (${importe.toFixed(2)}); no se ajusta en silencio.`,
      'porcionVariable',
    );
  }
}

function explicitas(input: SepararTramoSemifijoInput, importe: Decimal) {
  if (input.porcionFija === undefined || input.porcionVariable === undefined) {
    error('Este método necesita que declares las porciones fija y variable.', 'porcionFija');
  }
  const fija = new Decimal(input.porcionFija);
  const variable = new Decimal(input.porcionVariable);
  validarPartes(importe, fija, variable);
  return { fija, variable, costoVariableUnitario: null, coeficienteCorrelacion: null };
}

function puntosExtremos(observaciones: ObservacionSemifija[], importe: Decimal) {
  validarObservaciones(observaciones, 2);
  const ordenadas = [...observaciones].sort((a, b) => a.volumen - b.volumen);
  const baja = ordenadas[0]!;
  const alta = ordenadas[ordenadas.length - 1]!;
  const pendiente = new Decimal(alta.importe)
    .minus(baja.importe)
    .dividedBy(new Decimal(alta.volumen).minus(baja.volumen));
  const fija = new Decimal(baja.importe).minus(pendiente.times(baja.volumen));
  const variable = importe.minus(fija);
  validarPartes(importe, fija, variable);
  return { fija, variable, costoVariableUnitario: pendiente, coeficienteCorrelacion: null };
}

function correlacion(observaciones: ObservacionSemifija[], importe: Decimal) {
  validarObservaciones(observaciones, 2);
  const n = new Decimal(observaciones.length);
  const mediaX = Decimal.sum(...observaciones.map((o) => new Decimal(o.volumen))).dividedBy(n);
  const mediaY = Decimal.sum(...observaciones.map((o) => new Decimal(o.importe))).dividedBy(n);
  const numerador = Decimal.sum(
    ...observaciones.map((o) => new Decimal(o.volumen).minus(mediaX).times(new Decimal(o.importe).minus(mediaY))),
  );
  const sumaCuadradosX = Decimal.sum(
    ...observaciones.map((o) => new Decimal(o.volumen).minus(mediaX).pow(2)),
  );
  if (sumaCuadradosX.isZero()) {
    error('No se puede calcular la correlación si todos los volúmenes son iguales.', 'observacionesBase');
  }
  const pendiente = numerador.dividedBy(sumaCuadradosX);
  const fija = mediaY.minus(pendiente.times(mediaX));
  const variable = importe.minus(fija);

  const sumaCuadradosY = Decimal.sum(
    ...observaciones.map((o) => new Decimal(o.importe).minus(mediaY).pow(2)),
  );
  const coeficiente = sumaCuadradosY.isZero()
    ? null
    : numerador.dividedBy(sumaCuadradosX.times(sumaCuadradosY).sqrt());
  validarPartes(importe, fija, variable);
  return { fija, variable, costoVariableUnitario: pendiente, coeficienteCorrelacion: coeficiente };
}

/**
 * Separa un costo semifijo sin mutar datos. La misma función alimenta la vista
 * previa y el guardado, para que la pantalla nunca muestre una cuenta distinta
 * de la que termina persistida.
 */
export function separarTramoSemifijo(input: SepararTramoSemifijoInput): SeparacionTramoSemifijo {
  if (!Number.isFinite(input.importe) || input.importe < 0) {
    error('El importe a separar tiene que ser un número mayor o igual a cero.', 'importe');
  }
  const importe = new Decimal(input.importe);
  const observaciones = input.observacionesBase ?? [];

  if (input.metodo === 'DISPERSION_GRAFICA') {
    validarObservaciones(observaciones, 2);
  }

  const resultado = input.metodo === 'PUNTOS_EXTREMOS'
    ? puntosExtremos(observaciones, importe)
    : input.metodo === 'CORRELACION'
      ? correlacion(observaciones, importe)
      : explicitas(input, importe);

  return {
    importe: importe.toNumber(),
    porcionFija: resultado.fija.toDecimalPlaces(6).toNumber(),
    porcionVariable: resultado.variable.toDecimalPlaces(6).toNumber(),
    metodo: input.metodo,
    observacionesBase: observaciones,
    costoVariableUnitario: resultado.costoVariableUnitario?.toDecimalPlaces(6).toNumber() ?? null,
    coeficienteCorrelacion: resultado.coeficienteCorrelacion?.toDecimalPlaces(6).toNumber() ?? null,
  };
}
