import { MissingInputError } from '../../domain/errors/calculation-errors.js';
import type { CalculationInput } from './calculate.js';

/**
 * Chequeos de "¿hay insumos suficientes para calcular?" ANTES de correr el
 * motor. Fix crítico de la spec (B): un insumo faltante nunca debe tirar un
 * 500 crudo — siempre 422 {code:'MISSING_INPUT', field, message accionable}.
 *
 * Corre en dos capas:
 *   1) Acá: chequeos explícitos de casos conocidos (capacidad normal en 0,
 *      horas trabajadas en 0, centro productivo sin presupuesto derivable).
 *   2) `runCalculationSafe` (en calculate-run-service.ts): red de seguridad
 *      que atrapa cualquier `Error` genérico que el motor tire (ej. "base de
 *      distribución total = 0") y lo traduce a MissingInputError también.
 */
export function validateCalculationInputs(input: CalculationInput): void {
  for (const dept of input.directLabor.departments) {
    if (dept.hoursWorked === 0) {
      throw new MissingInputError(
        `directLabor.departments.${dept.name}.hoursWorked`,
        `El departamento "${dept.name}" tiene 0 horas trabajadas — cargá las horas del período antes de calcular.`,
      );
    }
  }

  const centerIds = new Set(input.indirectCosts.centers.map((c) => c.id));
  for (const setting of input.indirectCosts.productiveSettings) {
    if (!centerIds.has(setting.centerId)) {
      throw new MissingInputError(
        `indirectCosts.productiveSettings.${setting.centerId}`,
        `El centro "${setting.centerId}" tiene actividad cargada pero no existe entre los centros de costo — revisá la configuración de Costos Indirectos.`,
      );
    }
    if (setting.normalCapacity === 0) {
      throw new MissingInputError(
        `indirectCosts.productiveSettings.${setting.centerId}.normalCapacity`,
        `El centro "${setting.centerId}" no tiene capacidad normal cargada (bp = 0) — cargá el presupuesto de actividad normal antes de calcular.`,
      );
    }
  }

  if (input.indirectCosts.productiveSettings.length > 0 && input.indirectCosts.concepts.length === 0) {
    throw new MissingInputError(
      'indirectCosts.concepts',
      'No hay conceptos de CIF cargados (alquiler, energía, etc.) — el presupuesto de los centros productivos no se puede derivar sin ellos.',
    );
  }
}

/** Traduce cualquier error crudo del motor (JS `Error`) a un 422 accionable. */
export function toMissingInputError(err: unknown): MissingInputError {
  const message = err instanceof Error ? err.message : String(err);
  return new MissingInputError('indirectCosts', `No se pudo calcular: ${message}`);
}
