import { Decimal } from 'decimal.js';

type EstructuraBase = {
  nombre: string;
  costosFijos: number;
  costoVariableUnitario: number;
};

type EntradaComparacion = {
  tipoDecision: 'comparar_estructuras';
  estructuraA: EstructuraBase;
  estructuraB: EstructuraBase;
};

type EntradaDejarDeFabricar = {
  tipoDecision: 'dejar_de_fabricar';
  estructuraA: EstructuraBase & {
    costosFijosEvitables: number;
    costoVariableUnitarioLiquidacion: number;
  };
  estructuraB: EstructuraBase;
};

export type EntradaPuntoIndiferencia = (EntradaComparacion | EntradaDejarDeFabricar) & {
  unidadCantidad: string;
  moneda: string;
};

type RangoVolumen = { desde: number; hasta: number | null };

export interface ResultadoPuntoIndiferencia {
  cantidadIndiferencia: number | null;
  costoEnElPunto: number | null;
  convieneA: RangoVolumen | null;
  convieneB: RangoVolumen | null;
  motivoSinPunto: string | null;
  criterio: 'costos_totales' | 'r25_fijo_evitable_y_liquidacion';
  unidades: { cantidad: string; costo: string };
}

/**
 * Compara dos funciones lineales de costo sobre volúmenes no negativos.
 * En la decisión inversa aplica R25: sólo entran los fijos evitables y los
 * materiales de fabricar se valúan a precio de liquidación.
 */
export function puntoIndiferencia(input: EntradaPuntoIndiferencia): ResultadoPuntoIndiferencia {
  const r25 = input.tipoDecision === 'dejar_de_fabricar';
  const fijoA = new Decimal(r25 ? input.estructuraA.costosFijosEvitables : input.estructuraA.costosFijos);
  const variableA = new Decimal(r25 ? input.estructuraA.costoVariableUnitarioLiquidacion : input.estructuraA.costoVariableUnitario);
  const fijoB = new Decimal(input.estructuraB.costosFijos);
  const variableB = new Decimal(input.estructuraB.costoVariableUnitario);
  const criterio = r25 ? 'r25_fijo_evitable_y_liquidacion' : 'costos_totales';
  const base = { criterio, unidades: { cantidad: input.unidadCantidad, costo: input.moneda } } as const;

  if (variableA.eq(variableB)) {
    const iguales = fijoA.eq(fijoB);
    const ganaA = fijoA.lt(fijoB);
    return {
      ...base,
      cantidadIndiferencia: null,
      costoEnElPunto: null,
      convieneA: iguales || ganaA ? { desde: 0, hasta: null } : null,
      convieneB: iguales || !ganaA ? { desde: 0, hasta: null } : null,
      motivoSinPunto: iguales
        ? 'Las estructuras tienen el mismo costo variable y el mismo costo fijo; cuestan lo mismo en todo volumen.'
        : `Las estructuras tienen el mismo costo variable; ${ganaA ? input.estructuraA.nombre : input.estructuraB.nombre} conviene en todo volumen.`,
    };
  }

  const cantidad = fijoA.minus(fijoB).div(variableB.minus(variableA));
  if (!cantidad.isFinite() || cantidad.lt(0)) {
    const costoAEnCero = fijoA;
    const ganaA = costoAEnCero.lt(fijoB) || (costoAEnCero.eq(fijoB) && variableA.lt(variableB));
    return {
      ...base,
      cantidadIndiferencia: null,
      costoEnElPunto: null,
      convieneA: ganaA ? { desde: 0, hasta: null } : null,
      convieneB: ganaA ? null : { desde: 0, hasta: null },
      motivoSinPunto: `El cruce queda fuera del rango de volumen no negativo; ${ganaA ? input.estructuraA.nombre : input.estructuraB.nombre} conviene en todo volumen.`,
    };
  }

  const q = cantidad.toNumber();
  const costo = fijoA.plus(variableA.times(cantidad)).toNumber();
  const aConvieneArriba = variableA.lt(variableB);
  return {
    ...base,
    cantidadIndiferencia: q,
    costoEnElPunto: costo,
    convieneA: aConvieneArriba ? { desde: q, hasta: null } : { desde: 0, hasta: q },
    convieneB: aConvieneArriba ? { desde: 0, hasta: q } : { desde: q, hasta: null },
    motivoSinPunto: null,
  };
}
