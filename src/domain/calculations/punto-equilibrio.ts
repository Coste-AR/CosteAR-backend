import { Decimal } from 'decimal.js';
import { Money } from '../value-objects/money.js';
import type { ContribucionMarginal } from './contribucion-marginal.js';

/** Vista de costeo variable persistible; nunca modifica el resultado por absorción. */
export type PuntoEquilibrio =
  | { incompleta: true; unidadesEquilibrio: null; fechaUltimoRecalculo: string; motivos: string[] }
  | { incompleta: false; unidadesEquilibrio: number | null; fechaUltimoRecalculo: string; motivoSinEquilibrio?: string };

export function calcularPuntoEquilibrio(
  contribucion: ContribucionMarginal,
  fechaUltimoRecalculo: Date,
): PuntoEquilibrio {
  const fecha = fechaUltimoRecalculo.toISOString();
  if (contribucion.incompleta) {
    return { incompleta: true, unidadesEquilibrio: null, fechaUltimoRecalculo: fecha, motivos: contribucion.motivos };
  }

  if (contribucion.contribucionMarginalUnitaria <= 0) {
    return {
      incompleta: false,
      unidadesEquilibrio: null,
      fechaUltimoRecalculo: fecha,
      motivoSinEquilibrio: 'La contribución marginal unitaria es cero o negativa; no existe punto de equilibrio.',
    };
  }

  const costosFijos = Money.sum(
    contribucion.componentes
      .filter((componente) => componente.comportamientoVolumen === 'FIJO')
      .map((componente) => Money.of(componente.importeAbsorcion)),
  );
  return {
    incompleta: false,
    unidadesEquilibrio: costosFijos.divide(contribucion.contribucionMarginalUnitaria).toNumber(),
    fechaUltimoRecalculo: fecha,
  };
}

/**
 * Variación absoluta entre dos fotos válidas del punto de equilibrio.
 *
 * Un cambio hacia arriba y uno hacia abajo son ambos relevantes: el indicador
 * no decide si el movimiento fue bueno o malo, solo evita que pase inadvertido.
 * Sin dos puntos calculables (o con una referencia en cero) no inventa un
 * porcentaje para alertar.
 */
export function calcularVariacionPuntoEquilibrio(
  actual: PuntoEquilibrio,
  anterior: PuntoEquilibrio,
): number | null {
  const unidadesActuales = actual.unidadesEquilibrio;
  const unidadesAnteriores = anterior.unidadesEquilibrio;
  if (
    actual.incompleta ||
    anterior.incompleta ||
    unidadesActuales === null ||
    unidadesAnteriores === null ||
    unidadesAnteriores === 0
  ) {
    return null;
  }

  return new Decimal(unidadesActuales)
    .minus(unidadesAnteriores)
    .abs()
    .dividedBy(unidadesAnteriores)
    .times(100)
    .toNumber();
}
