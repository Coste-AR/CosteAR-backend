import { Decimal } from 'decimal.js';

/** Unidad elegida explícitamente por la empresa para leer sus resultados. */
export interface UnidadGestion {
  codigo: string;
  nombre: string;
  /** Cuántas unidades base contiene una unidad de gestión. */
  factor: number;
}

export interface ConversorUnidadGestion {
  unidadGestion: UnidadGestion | null;
  /** Un importe por unidad base pasa a importe por unidad de gestión. */
  importeUnitarioDesdeBase(valor: number): number;
  /** Una cantidad almacenada en unidad base pasa a cantidad de gestión. */
  cantidadDesdeBase(valor: number): number;
}

/**
 * Único punto del dominio donde se aplica el factor de la unidad de gestión.
 *
 * Sin una unidad declarada no se adivina ninguna: los valores siguen en base y
 * el contrato expone `unidadGestion: null` para que el consumidor conozca la
 * ausencia. Decimal evita agregar ruido binario a importes de costos.
 */
export function crearConversorUnidadGestion(
  unidadGestion: UnidadGestion | null,
): ConversorUnidadGestion {
  if (!unidadGestion) {
    return {
      unidadGestion: null,
      importeUnitarioDesdeBase: (valor) => valor,
      cantidadDesdeBase: (valor) => valor,
    };
  }

  const factor = new Decimal(unidadGestion.factor);
  return {
    unidadGestion,
    importeUnitarioDesdeBase: (valor) => new Decimal(valor).times(factor).toNumber(),
    cantidadDesdeBase: (valor) => new Decimal(valor).dividedBy(factor).toNumber(),
  };
}
