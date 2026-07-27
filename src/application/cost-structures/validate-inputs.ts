import { MissingInputError } from '../../domain/errors/calculation-errors.js';
import type { CalculationInput } from '../../domain/calculations/calculate.js';

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

// ---------------------------------------------------------------------------
// COSTEO POR PROCESOS (B19) — chequeos previos al cálculo
// ---------------------------------------------------------------------------

/** El cuadro de movimiento de un departamento, tal como está persistido. */
export interface ProcessScheduleCheck {
  initialWip?: number | null;
  startedInProduction?: number | null;
  receivedFromPrevious?: number | null;
  unitIncrease?: number | null;
  transferredOut?: number | null;
  finishedInStock?: number | null;
  /** Pérdida real total informada. Si no está, la única pérdida es la normal. */
  totalLossReported?: number | null;
  /** Pérdida normal ya calculada y persistida (`normalLossPct` × unidades del período). */
  normalLoss?: number | null;
  finalWip?: number | null;
  finalWipMpAvance?: number | null;
  finalWipConvAvance?: number | null;
}

/** Un departamento con todo lo que hace falta para revisarlo antes de calcular. */
export interface ProcessDepartmentCheck {
  name: string;
  sequence: number;
  /** `null` = el departamento no tiene cuadro cargado para este período. */
  schedule: ProcessScheduleCheck | null;
  /** Tiene líneas de producto cargadas ⇒ es punto de separación. */
  hasByProductLines: boolean;
  /** Método de reparto de costos conjuntos elegido, si hay. */
  jointMethod: string | null;
}

const num = (v: number | null | undefined): number => (v == null ? 0 : Number(v));

/**
 * Chequeos de Costeo por Procesos ANTES de correr el motor.
 *
 * El motor y el dominio ya validan casi todo esto, pero sus mensajes hablan de
 * un cuadro sin decir CUÁL: "el cuadro no cuadra" no le sirve a un costista con
 * cinco departamentos. Acá los mismos problemas salen con el NOMBRE del
 * departamento y una acción concreta — nunca un id, nunca una ruta interna.
 *
 * Lo que se revisa:
 *   1. Huecos en la cadena de departamentos (1, 2, 4 — falta el 3º).
 *   2. Departamento sin cuadro de movimiento cargado.
 *   3. Cuadro que no se puede resolver (faltan las dos incógnitas a la vez).
 *   4. Cuadro que no cuadra (entran ≠ salen).
 *   5. Existencia final con unidades pero sin grado de avance en conversión.
 *   6. Punto de separación con productos cargados y sin método de reparto.
 */
export function validateProcessInputs(departments: ProcessDepartmentCheck[]): void {
  if (departments.length === 0) return;

  const ordered = [...departments].sort((a, b) => a.sequence - b.sequence);

  // 1 — La cadena tiene que ser continua: el costo pasa de un departamento al
  // siguiente, así que un salto significa que falta una etapa o que quedó mal
  // numerada. Sin esto el motor encadena etapas que no se tocan.
  ordered.forEach((dept, i) => {
    const esperado = i + 1;
    if (dept.sequence !== esperado) {
      const previo = ordered[i - 1];
      throw new MissingInputError(
        'processDepartments.sequence',
        previo
          ? `La cadena de departamentos tiene un salto: después de "${previo.name}" sigue "${dept.name}", ` +
              `pero quedó en la posición ${dept.sequence} en vez de la ${esperado}. Reordená los departamentos ` +
              'para que la secuencia sea continua antes de calcular.'
          : `El primer departamento de la cadena es "${dept.name}" pero está en la posición ${dept.sequence} ` +
              'en vez de la 1ª. Reordená los departamentos antes de calcular.',
      );
    }
  });

  for (const dept of ordered) {
    // 2 — Sin cuadro no hay nada que calcular en esa etapa.
    if (!dept.schedule) {
      throw new MissingInputError(
        'unitMovementSchedule',
        `Falta el cuadro de movimiento de unidades del departamento "${dept.name}". ` +
          'Cargá las unidades que entran y salen antes de calcular.',
      );
    }

    const s = dept.schedule;
    const transferidasCargadas = s.transferredOut != null;
    const efCargada = s.finalWip != null;

    // 3 — El cuadro admite UNA incógnita (se despeja por diferencia), no dos.
    if (!transferidasCargadas && !efCargada) {
      throw new MissingInputError(
        'unitMovementSchedule.transferredOut',
        `El cuadro de movimiento de "${dept.name}" no se puede resolver: faltan a la vez las unidades ` +
          'terminadas y transferidas Y la existencia final en proceso. Cargá al menos una de las dos; ' +
          'el sistema deduce la otra por diferencia.',
      );
    }

    // 4 — Con los dos datos cargados el cuadro queda sobredeterminado: si no
    // cuadra, hay un error de carga y calcular sería arrastrarlo.
    if (transferidasCargadas && efCargada) {
      const entran =
        num(s.initialWip) +
        num(s.startedInProduction) +
        num(s.receivedFromPrevious) +
        num(s.unitIncrease);
      // Las unidades que salen por pérdida son la pérdida REAL TOTAL. Cuando el
      // costista no informa una pérdida total, la única que hubo es la normal
      // (calculada del % admitido): usar solo `totalLossReported` daba un falso
      // "no cuadra" por exactamente la pérdida normal en el caso más común, que
      // es cargar un % de merma admitida y ninguna merma extraordinaria.
      const perdidas =
        s.totalLossReported != null ? num(s.totalLossReported) : num(s.normalLoss);
      const salen = num(s.transferredOut) + num(s.finishedInStock) + perdidas + num(s.finalWip);
      const diferencia = entran - salen;
      if (Math.abs(diferencia) > 1e-4) {
        const sobran = diferencia > 0;
        throw new MissingInputError(
          'unitMovementSchedule.finalWip',
          `El cuadro de movimiento de "${dept.name}" no cuadra: entran ${entran} unidades y salen ${salen}. ` +
            `${sobran ? 'Sobran' : 'Faltan'} ${Math.abs(diferencia)} unidades sin justificar. ` +
            'Revisá las unidades cargadas, o dejá vacía la existencia final para que el sistema la deduzca.',
        );
      }
    }

    // 5 — Una EF con unidades y sin avance en conversión se valúa en CERO sin
    // avisar: el mes se cierra con el inventario subvaluado y nadie se entera.
    // El avance en materia prima no se pide: si no está, se asume 100 % (la MP
    // se incorpora al inicio del proceso), que es el caso normal de la cátedra.
    const efUnidades = efCargada ? num(s.finalWip) : null;
    if (efUnidades != null && efUnidades > 0 && s.finalWipConvAvance == null) {
      throw new MissingInputError(
        'unitMovementSchedule.finalWipConvAvance',
        `El departamento "${dept.name}" tiene ${efUnidades} unidades en existencia final pero no cargaste su ` +
          'grado de avance en conversión (mano de obra y carga fabril). Sin ese dato esas unidades se ' +
          'valuarían en cero. Cargá el % de avance de la existencia final.',
      );
    }

    // 6 — Punto de separación sin criterio de reparto: el costo conjunto no se
    // puede repartir entre los productos y el resultado sería arbitrario.
    if (dept.hasByProductLines && !dept.jointMethod) {
      throw new MissingInputError(
        'jointCostAllocation.method',
        `El departamento "${dept.name}" es punto de separación y tiene productos cargados, pero no elegiste ` +
          'el método de reparto de los costos conjuntos. Elegí uno (unidades físicas, rendimiento técnico, ' +
          'valor de mercado o valor neto de realización) antes de calcular.',
      );
    }
  }
}
