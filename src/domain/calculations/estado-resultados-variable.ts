import { Money } from '../value-objects/money.js';

export interface CostoFijoDirectoVariable {
  id: string;
  etiqueta: string;
  importe: number;
  /** R20: un fijo directo inevitable no justifica cerrar una línea. */
  evitable: boolean;
}

export interface SegmentoEstadoResultadosInput {
  id: string;
  etiqueta: string;
  /** Ausente/null = raíz. Permite línea → sector → empresa y más niveles. */
  padreId?: string | null;
  ventas: number;
  /** Sólo el costo variable de PRODUCCIÓN correspondiente a lo vendido. */
  costoVariableProduccionVendido: number;
  /** Gasto variable de venta del período; nunca integra la existencia final. */
  costoVariableComercializacion: number;
  costosFijosDirectos: CostoFijoDirectoVariable[];
  existenciaFinal?: {
    unidades: number;
    /** R17/§8.5: costo variable unitario de producción, sin comercialización. */
    costoVariableProduccionUnitario: number;
  };
}

export interface CostoFijoIndirectoVariable {
  id: string;
  etiqueta: string;
  importe: number;
  /** R19: los evitables se muestran antes que los inevitables. */
  evitable: boolean;
}

export interface EstadoResultadosVariableInput {
  segmentos: SegmentoEstadoResultadosInput[];
  costosFijosIndirectos: CostoFijoIndirectoVariable[];
}

export interface SegmentoEstadoResultados {
  id: string;
  etiqueta: string;
  padreId: string | null;
  profundidad: number;
  ventas: number;
  costoVariableProduccionVendido: number;
  costoVariableComercializacion: number;
  contribucionMarginalNivel1: number;
  /** Sólo los fijos directos del nodo; los de sus hijos quedan en sus niveles. */
  costosFijosDirectos: number;
  /** CM acumulada de los hijos, después de restar el fijo directo de cada nivel. */
  contribucionDespuesDeFijosDirectos: number;
  existenciaFinal: {
    unidades: number;
    costoVariableProduccionUnitario: number;
    valor: number;
  } | null;
  valorExistenciaFinalAcumulado: number;
  decisionCierre: {
    cerrar: false;
    motivo: string;
  } | null;
}

export interface FilaCostoFijoIndirecto {
  id: string;
  etiqueta: string;
  evitable: boolean;
  /**
   * R17: los fijos indirectos no se prorratean. La forma tipada conserva una
   * columna por segmento, pero sólo admite ausencia; el importe vive en total.
   */
  columnasSegmentos: Record<string, null>;
  total: number;
}

export interface EstadoResultadosVariable {
  segmentos: SegmentoEstadoResultados[];
  filasCostosFijosIndirectos: FilaCostoFijoIndirecto[];
  totales: {
    contribucionMarginalNivel1: number;
    costosFijosDirectos: number;
    contribucionMarginalNivel2: number;
    costosFijosIndirectosEvitables: number;
    contribucionMarginalNivel3: number;
    costosFijosIndirectosInevitables: number;
    resultado: number;
  };
}

interface AcumuladoSegmento {
  contribucionMarginalNivel1: Money;
  contribucionDespuesDeFijosDirectos: Money;
  valorExistenciaFinal: Money;
}

function validarArbol(segmentos: SegmentoEstadoResultadosInput[]): void {
  const ids = new Set<string>();
  for (const segmento of segmentos) {
    if (ids.has(segmento.id)) {
      throw new Error(`El segmento ${segmento.id} está repetido.`);
    }
    ids.add(segmento.id);
  }
  for (const segmento of segmentos) {
    if (segmento.padreId && !ids.has(segmento.padreId)) {
      throw new Error(`El segmento padre ${segmento.padreId} de ${segmento.id} no existe.`);
    }
  }
}

/**
 * Estado de resultados por costeo variable, en cascada de N niveles.
 *
 * Cada nodo resta únicamente sus fijos directos. Los fijos indirectos se
 * presentan después de consolidar las raíces, primero los evitables (R19) y
 * luego los inevitables; nunca bajan a una columna de segmento (R17).
 */
export function calcularEstadoResultadosVariable(
  input: EstadoResultadosVariableInput,
): EstadoResultadosVariable {
  validarArbol(input.segmentos);

  const hijos = new Map<string, SegmentoEstadoResultadosInput[]>();
  for (const segmento of input.segmentos) {
    if (!segmento.padreId) continue;
    const actuales = hijos.get(segmento.padreId) ?? [];
    actuales.push(segmento);
    hijos.set(segmento.padreId, actuales);
  }

  const acumulados = new Map<string, AcumuladoSegmento>();
  const visitando = new Set<string>();
  const profundidadPorId = new Map<string, number>();

  const acumular = (segmento: SegmentoEstadoResultadosInput, profundidad: number): AcumuladoSegmento => {
    const yaCalculado = acumulados.get(segmento.id);
    if (yaCalculado) return yaCalculado;
    if (visitando.has(segmento.id)) {
      throw new Error(`La jerarquía de segmentos contiene un ciclo en ${segmento.id}.`);
    }
    visitando.add(segmento.id);
    profundidadPorId.set(segmento.id, profundidad);

    const propiosNivel1 = Money.of(segmento.ventas)
      .subtract(Money.of(segmento.costoVariableProduccionVendido))
      .subtract(Money.of(segmento.costoVariableComercializacion));
    const fijosDirectosPropios = Money.sum(
      segmento.costosFijosDirectos.map((costo) => Money.of(costo.importe)),
    );
    const existenciaFinalPropia = segmento.existenciaFinal
      ? Money.of(segmento.existenciaFinal.costoVariableProduccionUnitario)
        .multiply(segmento.existenciaFinal.unidades)
      : Money.zero();
    const acumuladosHijos = (hijos.get(segmento.id) ?? []).map((hijo) =>
      acumular(hijo, profundidad + 1),
    );
    const acumulado = {
      contribucionMarginalNivel1: propiosNivel1.add(Money.sum(
        acumuladosHijos.map((hijo) => hijo.contribucionMarginalNivel1),
      )),
      contribucionDespuesDeFijosDirectos: propiosNivel1
        .subtract(fijosDirectosPropios)
        .add(Money.sum(acumuladosHijos.map((hijo) => hijo.contribucionDespuesDeFijosDirectos))),
      valorExistenciaFinal: existenciaFinalPropia.add(Money.sum(
        acumuladosHijos.map((hijo) => hijo.valorExistenciaFinal),
      )),
    };
    acumulados.set(segmento.id, acumulado);
    visitando.delete(segmento.id);
    return acumulado;
  };

  const raices = input.segmentos.filter((segmento) => !segmento.padreId);
  for (const raiz of raices) acumular(raiz, 0);
  // Un ciclo cerrado no tiene raíz y, por lo tanto, no sería visitado arriba.
  for (const segmento of input.segmentos) {
    if (!acumulados.has(segmento.id)) acumular(segmento, 0);
  }

  const segmentos = input.segmentos.map((segmento): SegmentoEstadoResultados => {
    const acumulado = acumulados.get(segmento.id)!;
    const fijosDirectos = Money.sum(segmento.costosFijosDirectos.map((costo) => Money.of(costo.importe)));
    const existenciaFinal = segmento.existenciaFinal
      ? {
          unidades: segmento.existenciaFinal.unidades,
          costoVariableProduccionUnitario: Money.of(
            segmento.existenciaFinal.costoVariableProduccionUnitario,
          ).toNumber(),
          valor: Money.of(segmento.existenciaFinal.costoVariableProduccionUnitario)
            .multiply(segmento.existenciaFinal.unidades)
            .toNumber(),
        }
      : null;
    const tieneFijoDirectoInevitable = segmento.costosFijosDirectos.some((costo) => !costo.evitable);
    const decisionCierre = acumulado.contribucionMarginalNivel1.greaterThan(Money.zero()) &&
      acumulado.contribucionDespuesDeFijosDirectos.isNegative() && tieneFijoDirectoInevitable
      ? {
          cerrar: false as const,
          motivo: 'Un resultado negativo no significa que haya que cerrar mientras la contribución marginal sea positiva y el fijo directo sea inevitable.',
        }
      : null;

    return {
      id: segmento.id,
      etiqueta: segmento.etiqueta,
      padreId: segmento.padreId ?? null,
      profundidad: profundidadPorId.get(segmento.id) ?? 0,
      ventas: Money.of(segmento.ventas).toNumber(),
      costoVariableProduccionVendido: Money.of(segmento.costoVariableProduccionVendido).toNumber(),
      costoVariableComercializacion: Money.of(segmento.costoVariableComercializacion).toNumber(),
      contribucionMarginalNivel1: acumulado.contribucionMarginalNivel1.toNumber(),
      costosFijosDirectos: fijosDirectos.toNumber(),
      contribucionDespuesDeFijosDirectos: acumulado.contribucionDespuesDeFijosDirectos.toNumber(),
      existenciaFinal,
      valorExistenciaFinalAcumulado: acumulado.valorExistenciaFinal.toNumber(),
      decisionCierre,
    };
  });

  const columnasVacias = Object.fromEntries(input.segmentos.map((segmento) => [segmento.id, null]));
  const filasCostosFijosIndirectos = [
    ...input.costosFijosIndirectos.filter((costo) => costo.evitable),
    ...input.costosFijosIndirectos.filter((costo) => !costo.evitable),
  ].map((costo): FilaCostoFijoIndirecto => ({
    id: costo.id,
    etiqueta: costo.etiqueta,
    evitable: costo.evitable,
    columnasSegmentos: { ...columnasVacias },
    total: Money.of(costo.importe).toNumber(),
  }));

  const nivel1 = Money.sum(raices.map((raiz) => acumulados.get(raiz.id)!.contribucionMarginalNivel1));
  const nivel2 = Money.sum(raices.map((raiz) => acumulados.get(raiz.id)!.contribucionDespuesDeFijosDirectos));
  const fijosDirectos = Money.sum(input.segmentos.flatMap((segmento) =>
    segmento.costosFijosDirectos.map((costo) => Money.of(costo.importe)),
  ));
  const indirectosEvitables = Money.sum(input.costosFijosIndirectos
    .filter((costo) => costo.evitable)
    .map((costo) => Money.of(costo.importe)));
  const indirectosInevitables = Money.sum(input.costosFijosIndirectos
    .filter((costo) => !costo.evitable)
    .map((costo) => Money.of(costo.importe)));
  const nivel3 = nivel2.subtract(indirectosEvitables);

  return {
    segmentos,
    filasCostosFijosIndirectos,
    totales: {
      contribucionMarginalNivel1: nivel1.toNumber(),
      costosFijosDirectos: fijosDirectos.toNumber(),
      contribucionMarginalNivel2: nivel2.toNumber(),
      costosFijosIndirectosEvitables: indirectosEvitables.toNumber(),
      contribucionMarginalNivel3: nivel3.toNumber(),
      costosFijosIndirectosInevitables: indirectosInevitables.toNumber(),
      resultado: nivel3.subtract(indirectosInevitables).toNumber(),
    },
  };
}
