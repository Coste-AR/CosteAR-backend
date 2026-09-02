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
