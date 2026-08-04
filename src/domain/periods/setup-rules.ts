/**
 * REGLAS DEL SETUP PREVIO DE COSTEO POR PROCESOS.
 *
 * Lógica pura: no toca base de datos. Contesta dos preguntas que después usan
 * el servicio (para aceptar o rechazar) y el frontend (para avisar antes de que
 * el costista apriete, no después).
 */

/** Un departamento tal como lo declara el costista en el setup. */
export interface SetupDepartment {
  name: string;
  /** 1 = primer departamento de la cadena. */
  sequence: number;
  /** Unidad física de este departamento (H12): "toneladas", "litros", "kg". */
  unit?: string | null;
  /**
   * Cuántas unidades de ESTE departamento produce cada unidad recibida del
   * anterior (H12). Solo tiene sentido para sequence > 1; en el primero se
   * ignora, igual que "recibidas del anterior" en el cuadro de movimiento.
   */
  conversionFromPrevious?: number | null;
}

export interface SetupInput {
  departments: SetupDepartment[];
  hasJointProducts: boolean;
  /** Cada cuántos días puede la planta informar el grado de avance. */
  wipCountFrequencyDays?: number | null;
  /** Largo del ciclo de costeo elegido, si eligió ciclos de días fijos. */
  periodLengthDays?: number | null;
}

/** Un problema que impide sellar el setup. `field` ubica el paso del wizard. */
export interface SetupProblem {
  field: string;
  message: string;
}

/**
 * Un aviso que NO bloquea. La diferencia importa: bloquear lo que es una mala
 * idea pero no un error deja al costista sin salida cuando su caso es legítimo
 * y nosotros no lo previmos.
 */
export interface SetupWarning {
  field: string;
  message: string;
}

const MAX_DEPARTMENTS = 50;

/**
 * Qué impide sellar el setup. Lista vacía = se puede sellar.
 *
 * Las reglas de secuencia salen del cuadro de movimiento (P3 §2): el primer
 * departamento no tiene "recibidas del anterior", y los sucesivos sí. Si la
 * cadena tiene huecos o duplicados, "el departamento anterior" deja de estar
 * definido y el arrastre entre departamentos no se puede calcular.
 */
export function validateSetup(input: SetupInput): SetupProblem[] {
  const problems: SetupProblem[] = [];
  const deps = input.departments ?? [];

  if (deps.length === 0) {
    problems.push({
      field: 'departments',
      message:
        'Agregá al menos un departamento. Sin departamentos declarados, el sistema no puede ' +
        'adjudicar los costos que van llegando ni calcular la producción equivalente.',
    });
    return problems; // Sin departamentos, el resto de las reglas no aplica.
  }

  if (deps.length > MAX_DEPARTMENTS) {
    problems.push({
      field: 'departments',
      message: `Declaraste ${deps.length} departamentos. El máximo es ${MAX_DEPARTMENTS}.`,
    });
  }

  const vacios = deps.filter((d) => !d.name?.trim());
  if (vacios.length > 0) {
    problems.push({
      field: 'departments',
      message: 'Hay departamentos sin nombre. Cada uno tiene que tener el suyo para poder identificarlo después.',
    });
  }

  const nombres = deps.map((d) => d.name?.trim().toLowerCase()).filter(Boolean);
  if (new Set(nombres).size !== nombres.length) {
    problems.push({
      field: 'departments',
      message:
        'Hay dos departamentos con el mismo nombre. Cuando llegue un documento no se va a poder ' +
        'saber a cuál de los dos corresponde.',
    });
  }

  // La secuencia tiene que ser 1..N sin huecos ni repetidos.
  const secuencias = [...deps.map((d) => d.sequence)].sort((a, b) => a - b);
  const esperada = secuencias.every((s, i) => s === i + 1);
  if (!esperada) {
    problems.push({
      field: 'departments',
      message:
        'El orden de los departamentos tiene que ser corrido desde 1, sin saltos ni repetidos. ' +
        'Es lo que define cuál recibe del anterior.',
    });
  }

  const freq = input.wipCountFrequencyDays;
  if (freq != null && (!Number.isInteger(freq) || freq < 1 || freq > 366)) {
    problems.push({
      field: 'wipCountFrequencyDays',
      message: 'Cada cuántos días se cuenta la producción en proceso tiene que ser un número entre 1 y 366.',
    });
  }

  // H12 — un factor de conversión de cero o negativo no significa nada
  // físicamente: no existe "cada unidad recibida produce -3 unidades".
  const factorInvalido = deps.some(
    (d) => d.conversionFromPrevious != null && d.conversionFromPrevious <= 0,
  );
  if (factorInvalido) {
    problems.push({
      field: 'departments',
      message:
        'El factor de conversión entre departamentos tiene que ser mayor a cero: es cuántas unidades ' +
        'del departamento actual produce cada unidad recibida del anterior.',
    });
  }

  return problems;
}

/**
 * Avisos que no bloquean.
 *
 * El importante es el desfasaje entre el ritmo de costeo y el de recuento. Si el
 * costista costea cada 3 días pero la planta releva cada 15, el sistema va a
 * calcular cinco veces sobre el mismo recuento — y cada resultado va a parecer
 * fresco sin serlo. No lo prohibimos (puede haber razones), pero no puede pasar
 * en silencio.
 */
export function setupWarnings(input: SetupInput): SetupWarning[] {
  const warnings: SetupWarning[] = [];
  const { wipCountFrequencyDays: recuento, periodLengthDays: ciclo } = input;

  if (recuento != null && ciclo != null && ciclo < recuento) {
    warnings.push({
      field: 'wipCountFrequencyDays',
      message:
        `Elegiste costear cada ${ciclo} día(s) pero la producción en proceso se cuenta cada ` +
        `${recuento}. Los períodos que caigan entre dos recuentos se van a calcular con el ` +
        'último dato disponible, no con uno nuevo: van a quedar marcados como provisorios.',
    });
  }

  if (input.departments?.length === 1) {
    warnings.push({
      field: 'departments',
      message:
        'Declaraste un solo departamento. Si tu producción pasa por varias etapas, conviene ' +
        'declararlas ahora: agregarlas después obliga a recargar los cuadros de movimiento.',
    });
  }

  if (input.hasJointProducts) {
    warnings.push({
      field: 'hasJointProducts',
      message:
        'Marcaste que el proceso rinde coproductos o subproductos. Vas a tener que definir el ' +
        'punto de separación y el método de reparto antes de poder calcular.',
    });
  }

  return warnings;
}
