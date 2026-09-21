import { Decimal } from 'decimal.js';
import { Money } from '../value-objects/money.js';
import type { ContribucionMarginal } from './contribucion-marginal.js';
import { calcularEquilibrioPorTramos, type TramoCostoCalculo } from './tramos.js';

/** Conceptos declarados por el llamador; no se infieren desde importes agregados. */
export interface ContextoFormulaEquilibrio {
  basadoEn: readonly { clave: string; etiqueta: string }[];
}

export type FormulaPuntoEquilibrio =
  | { tipo: 'fisico'; costosFijos: number; cm: number }
  | { tipo: 'razonContribucion'; cm: number; precio: number }
  | { tipo: 'razonPorMarcacion'; marcacion: number }
  | { tipo: 'monetarioPorRazon'; costosFijos: number; razon: number }
  | { tipo: 'monetarioPorMarcacion'; costosFijos: number; marcacion: number }
  | { tipo: 'utilidadFisica'; costosFijos: number; resultado: number; cm: number }
  | { tipo: 'utilidadMonetaria'; costosFijos: number; resultado: number; marcacion: number }
  | { tipo: 'multiproducto'; costosFijos: number; productos: readonly { participacion: number; cm: number }[] }
  | { tipo: 'costoFijoMaximo'; unidades: number; cm: number }
  | { tipo: 'precioNecesario'; costosFijos: number; unidades: number; costoVariable: number }
  | { tipo: 'costoVariableMaximo'; costosFijos: number; unidades: number; precio: number }
  | { tipo: 'resultadoActual'; unidades: number; cm: number; costosFijos: number }
  | { tipo: 'costoFijoConResultado'; unidades: number; cm: number; resultado: number }
  | { tipo: 'margenNecesario'; costosFijos: number; resultado: number; ventas: number };

export interface ResultadoFormulaEquilibrio extends ContextoFormulaEquilibrio {
  tipo: FormulaPuntoEquilibrio['tipo'];
  valor: number | null;
  unidad: 'unidades' | 'pesos' | 'pesos/unidad' | 'razon';
  /** M10-01 aporta el control de rango. Ausencia no significa rango infinito. */
  tramoValidez: null;
  motivoSinEquilibrio?: string;
}

/**
 * Formulario de Yardín, §5.10. Marcación sobre costo variable (no sobre ventas).
 * Usa Decimal sin redondear resultados intermedios. Cada división exige un
 * denominador positivo; una pérdida en resultadoActual sigue siendo válida.
 */
export function calcularFormulaPuntoEquilibrio(
  formula: FormulaPuntoEquilibrio,
  contexto: ContextoFormulaEquilibrio,
): ResultadoFormulaEquilibrio {
  const unidades = new Set<FormulaPuntoEquilibrio['tipo']>(['fisico', 'utilidadFisica', 'multiproducto']);
  const razones = new Set<FormulaPuntoEquilibrio['tipo']>(['razonContribucion', 'razonPorMarcacion', 'margenNecesario']);
  const unitarios = new Set<FormulaPuntoEquilibrio['tipo']>(['precioNecesario', 'costoVariableMaximo']);
  const base: ResultadoFormulaEquilibrio = {
    tipo: formula.tipo,
    valor: null,
    unidad: unidades.has(formula.tipo) ? 'unidades' : razones.has(formula.tipo) ? 'razon' : unitarios.has(formula.tipo) ? 'pesos/unidad' : 'pesos',
    basadoEn: contexto.basadoEn.map((concepto) => ({ ...concepto })),
    tramoValidez: null,
  };
  const ausente = (motivo: string): ResultadoFormulaEquilibrio => ({ ...base, motivoSinEquilibrio: motivo });
  const entradas = Object.values(formula).filter((valor): valor is number => typeof valor === 'number');
  if (!entradas.every(Number.isFinite)) return ausente('Los parámetros deben ser números finitos.');
  if ('costosFijos' in formula && formula.costosFijos < 0) return ausente('El costo fijo no puede ser negativo.');
  if ('unidades' in formula && formula.unidades < 0) return ausente('La cantidad de unidades no puede ser negativa.');

  const d = (valor: number) => new Decimal(valor);
  const resolver = (numerador: Decimal, denominador = new Decimal(1)): ResultadoFormulaEquilibrio => {
    if (!denominador.isFinite() || denominador.lte(0)) return ausente('El denominador es cero o negativo; no existe punto de equilibrio.');
    const valor = numerador.div(denominador).toNumber();
    return Number.isFinite(valor) ? { ...base, valor } : ausente('El resultado excede el rango numérico disponible.');
  };

  switch (formula.tipo) {
    case 'fisico': return resolver(d(formula.costosFijos), d(formula.cm));
    case 'razonContribucion':
      if (formula.cm <= 0) return ausente('La contribución marginal es cero o negativa; no existe punto de equilibrio.');
      return resolver(d(formula.cm), d(formula.precio));
    case 'razonPorMarcacion':
      if (formula.marcacion <= 0) return ausente('La marcación es cero o negativa; no existe punto de equilibrio.');
      return resolver(d(formula.marcacion), d(formula.marcacion).plus(1));
    case 'monetarioPorRazon': return resolver(d(formula.costosFijos), d(formula.razon));
    case 'monetarioPorMarcacion': return resolver(d(formula.costosFijos).times(d(formula.marcacion).plus(1)), d(formula.marcacion));
    case 'utilidadFisica': return resolver(d(formula.costosFijos).plus(formula.resultado), d(formula.cm));
    case 'utilidadMonetaria': return resolver(d(formula.costosFijos).plus(formula.resultado).times(d(formula.marcacion).plus(1)), d(formula.marcacion));
    case 'multiproducto': {
      if (formula.productos.length === 0 || formula.productos.some((producto) => !Number.isFinite(producto.cm) || !Number.isFinite(producto.participacion) || producto.participacion < 0)) {
        return ausente('Declare productos con contribuciones finitas y participaciones no negativas.');
      }
      const participacion = formula.productos.reduce((total, producto) => total.plus(producto.participacion), d(0));
      if (!participacion.eq(1)) return ausente('Las participaciones deben sumar uno; no se normaliza la mezcla.');
      const cm = formula.productos.reduce((total, producto) => total.plus(d(producto.cm).times(producto.participacion)), d(0));
      return resolver(d(formula.costosFijos), cm);
    }
    case 'costoFijoMaximo':
      if (formula.cm <= 0) return ausente('La contribución marginal no permite sostener costos fijos.');
      return resolver(d(formula.unidades).times(formula.cm));
    case 'precioNecesario':
      if (formula.unidades <= 0) return ausente('Declare una cantidad de unidades mayor que cero.');
      return resolver(d(formula.costosFijos).plus(d(formula.costoVariable).times(formula.unidades)), d(formula.unidades));
    case 'costoVariableMaximo':
      if (formula.unidades <= 0) return ausente('Declare una cantidad de unidades mayor que cero.');
      return resolver(d(formula.precio).times(formula.unidades).minus(formula.costosFijos), d(formula.unidades));
    case 'resultadoActual': return resolver(d(formula.unidades).times(formula.cm).minus(formula.costosFijos));
    case 'costoFijoConResultado':
      if (formula.cm <= 0) return ausente('La contribución marginal no permite sostener costos fijos.');
      return resolver(d(formula.unidades).times(formula.cm).minus(formula.resultado));
    case 'margenNecesario': return resolver(d(formula.costosFijos).plus(formula.resultado), d(formula.ventas).minus(formula.costosFijos).minus(formula.resultado));
  }
}

export interface ConceptoQueEnsanchaZona {
  clave: string;
  etiqueta: string;
  importe: number;
  /** Unidades que agrega este concepto al ancho, en orden estable por clave. */
  aporteAlAncho: number;
}

/** Vista de costeo variable persistible; nunca modifica el resultado por absorción. */
export type PuntoEquilibrio = (
  | { incompleta: true; unidadesEquilibrio: null; fechaUltimoRecalculo: string; motivos: string[] }
  | {
      incompleta: false;
      tipo: 'punto';
      unidadesEquilibrio: number | null;
      fechaUltimoRecalculo: string;
      motivoSinEquilibrio?: string;
    }
  | {
      incompleta: false;
      tipo: 'zona';
      unidadesEquilibrio: null;
      qMin: number;
      qMax: number;
      conceptosQueLaEnsanchan: ConceptoQueEnsanchaZona[];
      fechaUltimoRecalculo: string;
    }
) & {
  /** Opcional al leer fotos históricas anteriores a M3-01. */
  basadoEn?: ContextoFormulaEquilibrio['basadoEn'];
  tramoValidez?: null | { tramoId: string; desde: number; hasta: number | null; techo: number | null };
  motivoFueraDeTramo?: string;
  equilibrioTramoSiguiente?: number | null;
};

const motivoClasificacion = (etiqueta: string): string =>
  `Falta clasificar frente al volumen el rubro ${etiqueta}.`;

/** R13: acota la incertidumbre sin inventar una clasificación. */
function calcularZona(
  contribucion: Extract<ContribucionMarginal, { incompleta: true }>,
  fecha: string,
): PuntoEquilibrio | null {
  const sinClasificar = contribucion.componentes
    .filter((componente) => componente.importeAbsorcion !== 0 && componente.comportamientoVolumen === null)
    .sort((a, b) => a.clave.localeCompare(b.clave));
  const soloFaltaClasificar = sinClasificar.length > 0
    && contribucion.motivos.length === sinClasificar.length
    && sinClasificar.every((componente) => contribucion.motivos.includes(motivoClasificacion(componente.etiqueta)));
  if (
    !soloFaltaClasificar
    || contribucion.precioUnitario <= 0
    || contribucion.unidadesVendidas <= 0
    || contribucion.unidadesProducidas <= 0
  ) return null;

  const variablesConocidos = contribucion.componentes.filter(
    (componente) => componente.comportamientoVolumen === 'VARIABLE',
  );
  const costoVariableUnitario = (componentes: typeof contribucion.componentes): Decimal => {
    const produccion = Money.sum(
      componentes
        .filter((componente) => (componente.elemento ?? 'produccion') === 'produccion')
        .map((componente) => Money.of(componente.importeAbsorcion)),
    ).divide(contribucion.unidadesProducidas);
    const venta = Money.sum(
      componentes
        .filter((componente) => componente.elemento === 'venta')
        .map((componente) => Money.of(componente.importeAbsorcion)),
    ).divide(contribucion.unidadesVendidas);
    return new Decimal(produccion.add(venta).toNumber());
  };
  const costosFijosConocidos = Money.sum(
    contribucion.componentes
      .filter((componente) => componente.comportamientoVolumen === 'FIJO')
      .map((componente) => Money.of(componente.importeAbsorcion)),
  );
  const precio = new Decimal(contribucion.precioUnitario);
  const cmConTodosVariables = precio.minus(costoVariableUnitario([...variablesConocidos, ...sinClasificar]));
  const cmConTodosFijos = precio.minus(costoVariableUnitario(variablesConocidos));
  if (cmConTodosVariables.lte(0) || cmConTodosFijos.lte(0)) return null;

  const qMin = new Decimal(costosFijosConocidos.toNumber()).dividedBy(cmConTodosVariables);
  const qMax = new Decimal(
    costosFijosConocidos.add(Money.sum(sinClasificar.map((componente) => Money.of(componente.importeAbsorcion)))).toNumber(),
  ).dividedBy(cmConTodosFijos);

  // Se pasan las claves a FIJO en orden estable. Cada diferencia es auditable
  // y los aportes suman exactamente el ancho de la zona.
  let fijosAcumulados = costosFijosConocidos;
  let variablesPendientes = [...sinClasificar];
  let puntoAnterior = qMin;
  const conceptosQueLaEnsanchan = sinClasificar.map((componente) => {
    fijosAcumulados = fijosAcumulados.add(Money.of(componente.importeAbsorcion));
    variablesPendientes = variablesPendientes.filter((pendiente) => pendiente !== componente);
    const cm = precio.minus(costoVariableUnitario([...variablesConocidos, ...variablesPendientes]));
    const punto = new Decimal(fijosAcumulados.toNumber()).dividedBy(cm);
    const concepto = {
      clave: componente.clave,
      etiqueta: componente.etiqueta,
      importe: Money.of(componente.importeAbsorcion).toNumber(),
      aporteAlAncho: punto.minus(puntoAnterior).toNumber(),
    };
    puntoAnterior = punto;
    return concepto;
  });

  return {
    incompleta: false,
    tipo: 'zona',
    unidadesEquilibrio: null,
    qMin: qMin.toNumber(),
    qMax: qMax.toNumber(),
    conceptosQueLaEnsanchan,
    fechaUltimoRecalculo: fecha,
  };
}

export function calcularPuntoEquilibrio(
  contribucion: ContribucionMarginal,
  fechaUltimoRecalculo: Date,
  tramosCosto: readonly TramoCostoCalculo[] = [],
): PuntoEquilibrio {
  const fecha = fechaUltimoRecalculo.toISOString();
  const traza = { basadoEn: contribucion.componentes.map(({ clave, etiqueta }) => ({ clave, etiqueta })), tramoValidez: null };
  if (contribucion.incompleta) {
    const zona = calcularZona(contribucion, fecha);
    if (zona) return { ...traza, ...zona };
    return { ...traza, incompleta: true, unidadesEquilibrio: null, fechaUltimoRecalculo: fecha, motivos: contribucion.motivos };
  }

  if (contribucion.contribucionMarginalUnitaria <= 0) {
    return {
      ...traza,
      incompleta: false,
      tipo: 'punto',
      unidadesEquilibrio: null,
      fechaUltimoRecalculo: fecha,
      motivoSinEquilibrio: 'La contribución marginal unitaria es cero o negativa; no existe punto de equilibrio.',
    };
  }

  const costosFijos = Money.sum(
    contribucion.componentes
      .filter((componente) =>
        componente.comportamientoVolumen === 'FIJO' || componente.comportamientoVolumen === 'SEMIFIJO',
      )
      .map((componente) => Money.of(
        componente.comportamientoVolumen === 'SEMIFIJO'
          ? (componente.porcionFijaSemifija ?? 0)
          : componente.importeAbsorcion,
      )),
  );
  const unidadesEquilibrio = costosFijos.divide(contribucion.contribucionMarginalUnitaria).toNumber();
  if (tramosCosto.length > 0) {
    const porTramos = calcularEquilibrioPorTramos(tramosCosto);
    const vigente = porTramos.tramos[0];
    if (vigente) {
      return {
        ...traza,
        incompleta: false,
        tipo: 'punto',
        unidadesEquilibrio: vigente.q,
        fechaUltimoRecalculo: fecha,
        tramoValidez: { tramoId: vigente.tramoId, desde: vigente.desde, hasta: vigente.hasta, techo: vigente.techo },
        ...(vigente.q === null ? {
          motivoFueraDeTramo: vigente.motivoFueraDeTramo,
          equilibrioTramoSiguiente: porTramos.tramos.slice(1).find((tramo) => tramo.q !== null)?.q ?? null,
        } : {}),
      };
    }
  }
  return {
    ...traza,
    incompleta: false,
    tipo: 'punto',
    unidadesEquilibrio,
    fechaUltimoRecalculo: fecha,
  };
}

/**
 * Variación absoluta entre dos fotos válidas del punto de equilibrio.
 *
 * Un cambio hacia arriba y uno hacia abajo son ambos relevantes: el indicador
 * no decide si el movimiento fue bueno o malo, solo evita que pase inadvertido.
 * Sin dos puntos calculables (o con una referencia en cero) no inventa un
 * porcentaje para alertar.
 */
export function calcularVariacionPuntoEquilibrio(
  actual: PuntoEquilibrio,
  anterior: PuntoEquilibrio,
): number | null {
  const unidadesActuales = actual.unidadesEquilibrio;
  const unidadesAnteriores = anterior.unidadesEquilibrio;
  if (
    actual.incompleta ||
    anterior.incompleta ||
    unidadesActuales === null ||
    unidadesAnteriores === null ||
    unidadesAnteriores === 0
  ) {
    return null;
  }

  return new Decimal(unidadesActuales)
    .minus(unidadesAnteriores)
    .abs()
    .dividedBy(unidadesAnteriores)
    .times(100)
    .toNumber();
}
