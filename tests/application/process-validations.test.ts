import { describe, it, expect } from 'vitest';
import {
  validateProcessInputs,
  type ProcessDepartmentCheck,
} from '@/application/cost-structures/validate-inputs.js';
import { MissingInputError } from '@/domain/errors/calculation-errors.js';

/**
 * B19 — VALIDACIONES PREVIAS AL CÁLCULO DE COSTEO POR PROCESOS.
 *
 * El dominio ya frena casi todos estos casos, pero sus mensajes hablan de "el
 * cuadro" sin decir cuál: a un costista con cinco departamentos eso no le sirve.
 * Lo que se fija acá es el CONTRATO DEL MENSAJE, no la matemática (esa vive en
 * los tests del dominio):
 *   · siempre 422 (`MissingInputError`), nunca un 500 crudo;
 *   · siempre en castellano y con el NOMBRE del departamento;
 *   · nunca un id interno, una ruta de endpoint ni un nombre de columna;
 *   · siempre con una acción que el costista puede hacer en la pantalla.
 */

/** Un departamento sano: cuadro que cuadra, sin costos conjuntos. */
function sano(over: Partial<ProcessDepartmentCheck> = {}): ProcessDepartmentCheck {
  return {
    name: 'Destilado',
    sequence: 1,
    schedule: {
      initialWip: 5000,
      startedInProduction: 30000,
      transferredOut: 30000,
      finishedInStock: 0,
      totalLossReported: 1600,
      finalWip: 3400,
      finalWipConvAvance: 0.8,
    },
    hasByProductLines: false,
    jointMethod: null,
    ...over,
  };
}

/** Corre la validación y devuelve el error, exigiendo que haya fallado. */
function errorDe(departments: ProcessDepartmentCheck[]): MissingInputError {
  try {
    validateProcessInputs(departments);
  } catch (e) {
    expect(e).toBeInstanceOf(MissingInputError);
    return e as MissingInputError;
  }
  throw new Error('Se esperaba un error de validación y no hubo ninguno.');
}

describe('B19 — validaciones previas al cálculo de Procesos', () => {
  it('un conjunto sano no dispara nada', () => {
    expect(() => validateProcessInputs([sano()])).not.toThrow();
  });

  it('sin departamentos no valida nada (la estructura recién arranca)', () => {
    expect(() => validateProcessInputs([])).not.toThrow();
  });

  it('detecta un hueco en la cadena de departamentos y nombra a los dos vecinos', () => {
    const err = errorDe([
      sano({ name: 'Destilado', sequence: 1 }),
      sano({ name: 'Purificado', sequence: 2 }),
      sano({ name: 'Embotellado', sequence: 4 }),
    ]);

    expect(err.message).toContain('Purificado');
    expect(err.message).toContain('Embotellado');
    expect(err.message).toMatch(/salto/i);
  });

  it('detecta que la cadena no arranca en el primer departamento', () => {
    const err = errorDe([sano({ name: 'Purificado', sequence: 2 })]);
    expect(err.message).toContain('Purificado');
    expect(err.message).toMatch(/1ª|primer/i);
  });

  it('avisa qué departamento no tiene cuadro de movimiento cargado', () => {
    const err = errorDe([
      sano(),
      sano({ name: 'Purificado', sequence: 2, schedule: null }),
    ]);

    expect(err.message).toContain('Purificado');
    expect(err.message).toMatch(/cuadro de movimiento/i);
  });

  it('rechaza un cuadro con las dos incógnitas a la vez', () => {
    const err = errorDe([
      sano({ schedule: { initialWip: 5000, startedInProduction: 30000, finishedInStock: 0 } }),
    ]);

    expect(err.message).toContain('Destilado');
    expect(err.message).toMatch(/al menos una de las dos/i);
  });

  it('rechaza un cuadro que no cuadra y dice cuántas unidades sobran', () => {
    // Entran 35.000; salen 30.000 + 1.600 + 3.000 = 34.600 ⇒ sobran 400.
    const err = errorDe([
      sano({
        schedule: {
          initialWip: 5000,
          startedInProduction: 30000,
          transferredOut: 30000,
          finishedInStock: 0,
          totalLossReported: 1600,
          finalWip: 3000,
          finalWipConvAvance: 0.8,
        },
      }),
    ]);

    expect(err.message).toContain('Destilado');
    expect(err.message).toMatch(/no cuadra/i);
    expect(err.message).toContain('400');
    expect(err.message).toMatch(/sobran/i);
  });

  it('acepta el cuadro cuando la existencia final se deja para deducir por diferencia', () => {
    expect(() =>
      validateProcessInputs([
        sano({
          schedule: {
            initialWip: 5000,
            startedInProduction: 30000,
            transferredOut: 30000,
            finishedInStock: 0,
            totalLossReported: 1600,
            finalWip: null,
          },
        }),
      ]),
    ).not.toThrow();
  });

  it('exige el grado de avance en conversión cuando la existencia final tiene unidades', () => {
    const err = errorDe([sano({ schedule: { ...sano().schedule!, finalWipConvAvance: null } })]);

    expect(err.message).toContain('Destilado');
    expect(err.message).toMatch(/grado de avance/i);
    // La razón tiene que estar en el mensaje: si no, el costista no entiende
    // por qué le piden un dato que "no le cambia nada".
    expect(err.message).toMatch(/cero/i);
  });

  it('no exige el avance en conversión si la existencia final es cero', () => {
    expect(() =>
      validateProcessInputs([
        sano({
          schedule: {
            initialWip: 5000,
            startedInProduction: 30000,
            transferredOut: 33400,
            finishedInStock: 0,
            totalLossReported: 1600,
            finalWip: 0,
            finalWipConvAvance: null,
          },
        }),
      ]),
    ).not.toThrow();
  });

  it('no exige el avance en materia prima (se asume incorporada al inicio)', () => {
    expect(() =>
      validateProcessInputs([sano({ schedule: { ...sano().schedule!, finalWipMpAvance: null } })]),
    ).not.toThrow();
  });

  it('rechaza un punto de separación con productos y sin método de reparto', () => {
    const err = errorDe([sano({ hasByProductLines: true, jointMethod: null })]);

    expect(err.message).toContain('Destilado');
    expect(err.message).toMatch(/costos conjuntos/i);
    // El mensaje ofrece las opciones reales, no un código de enum.
    expect(err.message).toMatch(/valor neto de realización/i);
  });

  it('acepta el punto de separación cuando el método está elegido', () => {
    expect(() =>
      validateProcessInputs([
        sano({ hasByProductLines: true, jointMethod: 'NET_REALIZABLE_VALUE' }),
      ]),
    ).not.toThrow();
  });

  it('ningún mensaje expone ids internos, rutas ni nombres de columna', () => {
    const casos: ProcessDepartmentCheck[][] = [
      [sano({ name: 'Purificado', sequence: 2 })],
      [sano(), sano({ name: 'Purificado', sequence: 2, schedule: null })],
      [sano({ schedule: { initialWip: 1, finishedInStock: 0 } })],
      [sano({ schedule: { ...sano().schedule!, finalWip: 3000 } })],
      [sano({ schedule: { ...sano().schedule!, finalWipConvAvance: null } })],
      [sano({ hasByProductLines: true, jointMethod: null })],
    ];

    for (const caso of casos) {
      const { message } = errorDe(caso);
      expect(message).not.toMatch(/\/structures\/|\/api\//);
      expect(message).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/i); // UUID
      expect(message).not.toMatch(/finalWip|initialWip|periodId|departmentId/);
    }
  });
});
