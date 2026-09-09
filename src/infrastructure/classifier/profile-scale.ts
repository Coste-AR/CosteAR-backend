import type { PhysicalScale, ScaleCalibrationWarning } from './types.js';

/**
 * Por debajo de tres veces la diferencia puede ser variación operativa normal;
 * a partir de ese factor el perfil deja de ser una referencia prudente sin una
 * recalibración humana. No cambia pesos ni confianza: solo expone la señal.
 */
export const MATERIAL_SCALE_FACTOR = 3;

function isComparableScale(scale: PhysicalScale | null | undefined): scale is PhysicalScale {
  if (!scale) return false;
  return Number.isFinite(scale.value) && scale.value > 0 && Boolean(scale.unit.trim());
}

export function getScaleCalibrationWarning(
  operationScale: PhysicalScale | null | undefined,
  profileScale: PhysicalScale | null | undefined,
): ScaleCalibrationWarning | undefined {
  if (!isComparableScale(operationScale) || !isComparableScale(profileScale)) return undefined;

  if (operationScale.unit !== profileScale.unit) {
    return { code: 'UNIT_MISMATCH', operationScale, profileScale };
  }

  const materialFactor = Math.max(operationScale.value, profileScale.value) / Math.min(operationScale.value, profileScale.value);
  if (materialFactor < MATERIAL_SCALE_FACTOR) return undefined;

  return { code: 'OUTSIDE_CALIBRATED_RANGE', operationScale, profileScale, materialFactor };
}
