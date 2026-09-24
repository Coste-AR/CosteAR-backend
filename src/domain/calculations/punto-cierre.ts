import { Decimal } from 'decimal.js';
import {
  calcularFormulaPuntoEquilibrio,
  type ContextoFormulaEquilibrio,
  type FormulaPuntoEquilibrio,
  type ResultadoFormulaEquilibrio,
} from './punto-equilibrio.js';

export const TEXTO_RESULTADO_NEGATIVO = 'un resultado negativo no significa que haya que cerrar';
export const TEXTO_SOSTIENE_CAJA = 'pierde económicamente y sostiene la caja';

interface BaseConceptoErogable {
  clave: string;
  etiqueta: string;
  erogable: boolean | null;
  /** Primer horizonte en el que el desembolso se vuelve exigible. */
  horizonteErogableMeses: number | null;
}

export type ConceptoErogableValorizado = BaseConceptoErogable & (
  | { comportamientoVolumen: 'FIJO'; importe: number }
  | { comportamientoVolumen: 'VARIABLE'; importeUnitario: number }
  | {
      comportamientoVolumen: 'SEMIFIJO';
      importeFijo: number;
      importeVariableUnitario: number;
    }
);

export interface PerfilErogableCompleto {
  incompleto: false;
  horizonteMeses: number;
  precioUnitario: number;
  costosFijosErogables: number;
  costoVariableUnitarioErogable: number;
  contribucionMarginalFinanciera: number;
  razonContribucionFinanciera: number;
  marcacionFinanciera: number | null;
  conceptosIncluidos: ContextoFormulaEquilibrio['basadoEn'];
  conceptosExcluidos: ContextoFormulaEquilibrio['basadoEn'];
}

export interface PerfilErogableIncompleto {
  incompleto: true;
  horizonteMeses: number;
  motivos: string[];
}

export type PerfilErogable = PerfilErogableCompleto | PerfilErogableIncompleto;

/**
 * R7: "erogable" siempre se evalúa para un horizonte declarado. Un concepto
 * con erogabilidad desconocida no se convierte en cero ni se hereda de otro
 * período: deja el perfil ausente y nombra el dato que falta.
 */
export function resolverPerfilErogable(input: {
  precioUnitario: number;
  horizonteMeses: number;
  conceptos: readonly ConceptoErogableValorizado[];
}): PerfilErogable {
  const motivos: string[] = [];
  if (!Number.isFinite(input.precioUnitario) || input.precioUnitario <= 0) {
    motivos.push('El precio unitario debe ser un número finito mayor que cero.');
  }
  if (!Number.isInteger(input.horizonteMeses) || input.horizonteMeses <= 0) {
    motivos.push('El horizonte debe declararse en meses enteros mayores que cero.');
  }

  for (const concepto of input.conceptos) {
    const importes = concepto.comportamientoVolumen === 'FIJO'
      ? [concepto.importe]
      : concepto.comportamientoVolumen === 'VARIABLE'
        ? [concepto.importeUnitario]
        : [concepto.importeFijo, concepto.importeVariableUnitario];
    if (!importes.every(Number.isFinite)) {
      motivos.push(`El concepto "${concepto.etiqueta}" tiene un importe no finito.`);
    }
    if (concepto.erogable === null) {
      motivos.push(`Falta declarar si el concepto "${concepto.etiqueta}" es erogable.`);
    } else if (
      concepto.erogable
      && (!Number.isInteger(concepto.horizonteErogableMeses) || concepto.horizonteErogableMeses! <= 0)
    ) {
      motivos.push(`Falta declarar el horizonte erogable del concepto "${concepto.etiqueta}".`);
    }
  }

  if (motivos.length > 0) return { incompleto: true, horizonteMeses: input.horizonteMeses, motivos };

  const incluidos = input.conceptos.filter(
    (concepto) => concepto.erogable === true && concepto.horizonteErogableMeses! <= input.horizonteMeses,
  );
  const costosFijos = incluidos.reduce(
    (total, concepto) => total.plus(
      concepto.comportamientoVolumen === 'FIJO'
        ? concepto.importe
        : concepto.comportamientoVolumen === 'SEMIFIJO'
          ? concepto.importeFijo
          : 0,
    ),
    new Decimal(0),
  );
  const costoVariable = incluidos.reduce(
    (total, concepto) => total.plus(
      concepto.comportamientoVolumen === 'VARIABLE'
        ? concepto.importeUnitario
        : concepto.comportamientoVolumen === 'SEMIFIJO'
          ? concepto.importeVariableUnitario
          : 0,
    ),
    new Decimal(0),
  );
  const precio = new Decimal(input.precioUnitario);
  const cm = precio.minus(costoVariable);
  const marcacion = costoVariable.eq(0) ? null : cm.dividedBy(costoVariable);
  const referencia = (concepto: ConceptoErogableValorizado) => ({ clave: concepto.clave, etiqueta: concepto.etiqueta });

  return {
    incompleto: false,
    horizonteMeses: input.horizonteMeses,
    precioUnitario: input.precioUnitario,
    costosFijosErogables: costosFijos.toNumber(),
    costoVariableUnitarioErogable: costoVariable.toNumber(),
    contribucionMarginalFinanciera: cm.toNumber(),
    razonContribucionFinanciera: cm.dividedBy(precio).toNumber(),
    marcacionFinanciera: marcacion?.toNumber() ?? null,
    conceptosIncluidos: incluidos.map(referencia),
    conceptosExcluidos: input.conceptos.filter((concepto) => !incluidos.includes(concepto)).map(referencia),
  };
}

export type ResultadoFormulaPuntoCierre = ResultadoFormulaEquilibrio & {
  horizonteMeses: number;
  advertencia: typeof TEXTO_RESULTADO_NEGATIVO;
};

/** Aplica CF→CFE y cv→cve a cada variante del formulario de M3-01. */
export function calcularFormulaPuntoCierre(
  formula: FormulaPuntoEquilibrio,
  perfil: PerfilErogable,
  contexto: ContextoFormulaEquilibrio,
  mezclaFinanciera?: readonly { participacion: number; cm: number }[],
): ResultadoFormulaPuntoCierre {
  const base = calcularFormulaPuntoEquilibrio(formula, contexto);
  if (perfil.incompleto) {
    return {
      ...base,
      valor: null,
      motivoSinEquilibrio: perfil.motivos.join(' '),
      horizonteMeses: perfil.horizonteMeses,
      advertencia: TEXTO_RESULTADO_NEGATIVO,
    };
  }

  const cf = perfil.costosFijosErogables;
  const cm = perfil.contribucionMarginalFinanciera;
  const cv = perfil.costoVariableUnitarioErogable;
  const marcacion = perfil.marcacionFinanciera;
  let financiera: FormulaPuntoEquilibrio;
  switch (formula.tipo) {
    case 'fisico': financiera = { ...formula, costosFijos: cf, cm }; break;
    case 'razonContribucion': financiera = { ...formula, cm, precio: perfil.precioUnitario }; break;
    case 'razonPorMarcacion': financiera = { ...formula, marcacion: marcacion ?? 0 }; break;
    case 'monetarioPorRazon': financiera = { ...formula, costosFijos: cf, razon: perfil.razonContribucionFinanciera }; break;
    case 'monetarioPorMarcacion': financiera = { ...formula, costosFijos: cf, marcacion: marcacion ?? 0 }; break;
    case 'utilidadFisica': financiera = { ...formula, costosFijos: cf, cm }; break;
    case 'utilidadMonetaria': financiera = { ...formula, costosFijos: cf, marcacion: marcacion ?? 0 }; break;
    case 'multiproducto': financiera = { ...formula, costosFijos: cf, productos: mezclaFinanciera ?? [] }; break;
    case 'costoFijoMaximo': financiera = { ...formula, cm }; break;
    case 'precioNecesario': financiera = { ...formula, costosFijos: cf, costoVariable: cv }; break;
    case 'costoVariableMaximo': financiera = { ...formula, costosFijos: cf, precio: perfil.precioUnitario }; break;
    case 'resultadoActual': financiera = { ...formula, cm, costosFijos: cf }; break;
    case 'costoFijoConResultado': financiera = { ...formula, cm }; break;
    case 'margenNecesario': financiera = { ...formula, costosFijos: cf }; break;
  }
  const resultado = calcularFormulaPuntoEquilibrio(financiera, contexto);
  if (formula.tipo === 'multiproducto' && !mezclaFinanciera) {
    resultado.motivoSinEquilibrio = 'Falta declarar la contribución marginal financiera de cada producto.';
  }
  return {
    ...resultado,
    horizonteMeses: perfil.horizonteMeses,
    advertencia: TEXTO_RESULTADO_NEGATIVO,
  };
}

export type PuntoCierrePorHorizonte = ResultadoFormulaPuntoCierre & {
  costosFijosErogables: number | null;
  costoVariableUnitarioErogable: number | null;
  contribucionMarginalFinanciera: number | null;
  situacion: typeof TEXTO_SOSTIENE_CAJA | null;
  conceptosIncluidos: ContextoFormulaEquilibrio['basadoEn'];
  conceptosExcluidos: ContextoFormulaEquilibrio['basadoEn'];
};

/** Devuelve todos los horizontes pedidos; nunca colapsa 1 y 12 meses en un único número. */
export function calcularPuntosCierre(input: {
  precioUnitario: number;
  horizontesMeses: readonly number[];
  conceptos: readonly ConceptoErogableValorizado[];
  contexto: ContextoFormulaEquilibrio;
  puntoEquilibrioEconomico: number | null;
  unidadesActuales: number | null;
}): PuntoCierrePorHorizonte[] {
  return input.horizontesMeses.map((horizonteMeses) => {
    const perfil = resolverPerfilErogable({
      precioUnitario: input.precioUnitario,
      horizonteMeses,
      conceptos: input.conceptos,
    });
    const resultado = calcularFormulaPuntoCierre(
      { tipo: 'fisico', costosFijos: 0, cm: 0 },
      perfil,
      input.contexto,
    );
    const situacion = resultado.valor !== null
      && input.puntoEquilibrioEconomico !== null
      && input.unidadesActuales !== null
      && input.unidadesActuales >= resultado.valor
      && input.unidadesActuales < input.puntoEquilibrioEconomico
      ? TEXTO_SOSTIENE_CAJA
      : null;
    return {
      ...resultado,
      costosFijosErogables: perfil.incompleto ? null : perfil.costosFijosErogables,
      costoVariableUnitarioErogable: perfil.incompleto ? null : perfil.costoVariableUnitarioErogable,
      contribucionMarginalFinanciera: perfil.incompleto ? null : perfil.contribucionMarginalFinanciera,
      conceptosIncluidos: perfil.incompleto ? [] : perfil.conceptosIncluidos,
      conceptosExcluidos: perfil.incompleto ? [] : perfil.conceptosExcluidos,
      situacion,
    };
  });
}
