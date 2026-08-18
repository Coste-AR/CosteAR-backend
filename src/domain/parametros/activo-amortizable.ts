import { Decimal } from 'decimal.js';

/**
 * ACTIVO AMORTIZABLE — S-03 (T-03).
 *
 * En una explotación de ponedoras el plantel **no es un insumo del período: es un
 * activo**. Se compra una vez y produce durante meses.
 *
 * El clasificador ya lo sabía: `industry-profile.ts` deja `gallina`, `ponedora` y
 * `pollita` deliberadamente FUERA de `mpKeywords`. Pero el modelo de dominio no
 * tenía la entidad, así que esas facturas se clasificaban lejos de MP y no
 * aterrizaban en ningún lado.
 *
 * La amortización SIEMPRE se deriva. Nunca se carga a mano: un valor tipeado se
 * desincroniza del costo y de la vida útil en cuanto alguno de los dos cambia.
 */

export interface ActivoParaAmortizar {
  /** Costo total de adquisición del activo. */
  costoAdquisicion: number;
  /** Lo que se espera recuperar al final. En avicultura, la gallina de descarte. */
  valorResidual: number;
  /**
   * Meses de vida útil.
   *
   * Viene de `ParametroCosteo` (`vida_util_lote_meses`), NUNCA de una constante.
   * Hay un test que falla si alguien escribe 24 a mano en el cálculo.
   */
  vidaUtilMeses: number;
}

export interface AmortizacionMensual {
  /** Cuota del período. Es lo que entra al costo como CIP. */
  cuota: number;
  /** Monto total a amortizar a lo largo de la vida útil. */
  montoAmortizable: number;
  /** Cuota por unidad del activo (por ave, por máquina). */
  cuotaPorUnidad: number | null;
}

/**
 * Cuota mensual = (costo − valor residual) / vida útil.
 *
 * @param cantidadUnidades opcional, para expresar la cuota por ave.
 */
export function calcularAmortizacionMensual(
  activo: ActivoParaAmortizar,
  cantidadUnidades?: number | null,
): AmortizacionMensual {
  if (!Number.isFinite(activo.vidaUtilMeses) || activo.vidaUtilMeses <= 0) {
    throw new Error(
      'La vida útil del activo tiene que ser mayor que cero. ' +
        'Cargala en el parámetro de costeo que corresponda.',
    );
  }
  if (activo.valorResidual > activo.costoAdquisicion) {
    throw new Error(
      'El valor residual no puede superar al costo de adquisición: ' +
        'daría una amortización negativa.',
    );
  }

  const montoAmortizable = new Decimal(activo.costoAdquisicion).minus(activo.valorResidual);
  const cuota = montoAmortizable.dividedBy(activo.vidaUtilMeses);

  return {
    cuota: cuota.toNumber(),
    montoAmortizable: montoAmortizable.toNumber(),
    cuotaPorUnidad:
      cantidadUnidades && cantidadUnidades > 0
        ? cuota.dividedBy(cantidadUnidades).toNumber()
        : null,
  };
}

/**
 * ¿Este período soporta costo por el activo?
 *
 * Comprar el activo **no** impacta el costo del período de compra: ahí solo hay
 * una salida de caja y un alta de activo. El costo aparece repartido en los
 * períodos en los que el activo produce.
 *
 * Confundir las dos cosas es lo que hace que el mes de la compra se vea
 * catastrófico y los siguientes, engañosamente baratos.
 */
export function amortizaEnPeriodo(fechaAlta: Date, inicioPeriodo: Date, finPeriodo: Date): boolean {
  // El período de ALTA no amortiza: la amortización arranca al período siguiente.
  if (fechaAlta >= inicioPeriodo && fechaAlta <= finPeriodo) return false;
  return fechaAlta < inicioPeriodo;
}
