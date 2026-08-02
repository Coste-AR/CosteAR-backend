/**
 * QUÉ RITMO USA UNA ESTRUCTURA.
 *
 * El ritmo de costeo se puede definir en dos lados y hay que resolver cuál gana:
 *
 *   · `CostStructure.periodicity`  → lo que eligió el costista para ESTE producto.
 *   · `Company.periodicity`        → el ritmo por defecto de la empresa.
 *
 * Gana el de la estructura. Si no tiene (null), hereda el de la empresa — que es
 * exactamente lo que hacía el sistema antes de que la frecuencia fuera
 * configurable por producto.
 *
 * Todo el código que necesite saber "cada cuánto costea esta estructura" tiene
 * que pasar por acá. Si cada servicio lo resuelve por su cuenta, alcanza con que
 * uno se olvide del override para que dos partes del sistema calculen períodos
 * distintos para la misma estructura.
 */

import {
  IncompleteRhythmError,
  type Periodicity,
  type Rhythm,
} from './period-calendar.js';

/** Los campos de ritmo de una `CostStructure` (solo eso: no pedimos la fila entera). */
export interface StructureRhythmFields {
  periodicity: string | null;
  periodLengthDays: number | null;
  periodAnchorDate: Date | null;
}

/**
 * El ritmo de la EMPRESA. `CUSTOM_DAYS` no es válido acá: los ciclos de días
 * fijos necesitan largo y ancla, y esos campos viven en la estructura, no en la
 * empresa. El enum de Postgres igual lo permite (es un solo tipo compartido), así
 * que la guarda es real y no defensiva de más.
 */
export function companyRhythm(periodicity: string): Periodicity {
  if (periodicity === 'CUSTOM_DAYS') throw new IncompleteRhythmError();
  return periodicity as Periodicity;
}

/**
 * El ritmo efectivo de una estructura: el suyo si lo tiene, el de la empresa si
 * no. Con `CUSTOM_DAYS` arma el objeto con largo y ancla; si falta alguno de los
 * dos avisa con `IncompleteRhythmError` en vez de caer a mensual en silencio —
 * heredar un ritmo que el costista no eligió le cambiaría los períodos sin que
 * nadie se entere. La base tiene el mismo invariante en un CHECK; esta guarda
 * cubre el hueco entre que se lee la fila y se usa.
 */
export function effectiveRhythm(
  structure: StructureRhythmFields,
  companyPeriodicity: string,
): Rhythm {
  if (structure.periodicity == null) return companyRhythm(companyPeriodicity);

  if (structure.periodicity !== 'CUSTOM_DAYS') return structure.periodicity as Periodicity;

  if (structure.periodLengthDays == null || structure.periodAnchorDate == null) {
    throw new IncompleteRhythmError();
  }

  return {
    kind: 'CUSTOM_DAYS',
    lengthDays: structure.periodLengthDays,
    anchorDate: structure.periodAnchorDate,
  };
}
