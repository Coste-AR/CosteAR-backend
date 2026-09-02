import { Money } from '../value-objects/money.js';

/** Claves estables de los totales que ya consolida el motor de absorción. */
export const CLAVES_COMPORTAMIENTO_CONTRIBUCION = {
  materiaPrima: 'comportamiento_materia_prima',
  manoObraDirecta: 'comportamiento_mano_obra_directa',
  costosIndirectos: 'comportamiento_costos_indirectos',
} as const;

export type ComportamientoVolumen = 'VARIABLE' | 'FIJO' | 'SEMIFIJO';

export interface FilaComportamiento {
  id: string;
  clave: string;
  comportamientoVolumen: ComportamientoVolumen | null;
  structureId: string | null;
  periodId: string | null;
  clasificadoPorUserId: string | null;
  clasificadoEn: Date | null;
}

export interface ComponenteAbsorcion {
  clave: string;
  etiqueta: string;
  importeAbsorcion: number;
}

export interface ContribucionMarginalInput {
  precioUnitario: number;
  unidadesVendidas: number;
  componentes: ComponenteAbsorcion[];
  clasificaciones: FilaComportamiento[];
  contexto: { structureId: string; periodId: string | null };
}

export interface TrazaComponenteContribucion extends ComponenteAbsorcion {
  comportamientoVolumen: ComportamientoVolumen | null;
  origen: 'periodo' | 'estructura' | 'empresa' | null;
  parametroId: string | null;
  clasificadoPorUserId: string | null;
  clasificadoEn: string | null;
}

export interface ContribucionMarginalCompleta {
  incompleta: false;
  precioUnitario: number;
  unidadesVendidas: number;
  totalAbsorcion: number;
  costoVariableTotal: number;
  costoVariableUnitario: number;
  contribucionMarginalUnitaria: number;
  componentes: TrazaComponenteContribucion[];
}

export interface ContribucionMarginalIncompleta {
  incompleta: true;
  precioUnitario: number;
  unidadesVendidas: number;
  totalAbsorcion: number;
  costoVariableTotal: null;
  costoVariableUnitario: null;
  contribucionMarginalUnitaria: null;
  componentes: TrazaComponenteContribucion[];
  motivos: string[];
}

export type ContribucionMarginal = ContribucionMarginalCompleta | ContribucionMarginalIncompleta;

/** Misma cascada de `ParametroCosteo`: período → estructura → empresa. */
export function resolverComportamiento(
  clave: string,
  filas: FilaComportamiento[],
  contexto: { structureId: string; periodId: string | null },
): { fila: FilaComportamiento; origen: TrazaComponenteContribucion['origen'] } | null {
  const candidatas = filas.filter((fila) => fila.clave === clave && fila.comportamientoVolumen !== null);
  const porPeriodo = contexto.periodId
    ? candidatas.find((fila) => fila.periodId === contexto.periodId)
    : undefined;
  if (porPeriodo) return { fila: porPeriodo, origen: 'periodo' };

  const porEstructura = candidatas.find(
    (fila) => fila.periodId === null && fila.structureId === contexto.structureId,
  );
  if (porEstructura) return { fila: porEstructura, origen: 'estructura' };

  const porEmpresa = candidatas.find((fila) => fila.periodId === null && fila.structureId === null);
  return porEmpresa ? { fila: porEmpresa, origen: 'empresa' } : null;
}

/** Vista de costeo variable sobre importes ya emitidos por absorción. */
export function calcularContribucionMarginal(input: ContribucionMarginalInput): ContribucionMarginal {
  const componentes = input.componentes.map((componente): TrazaComponenteContribucion => {
    const resuelta = resolverComportamiento(componente.clave, input.clasificaciones, input.contexto);
    return {
      ...componente,
      comportamientoVolumen: resuelta?.fila.comportamientoVolumen ?? null,
      origen: resuelta?.origen ?? null,
      parametroId: resuelta?.fila.id ?? null,
      clasificadoPorUserId: resuelta?.fila.clasificadoPorUserId ?? null,
      clasificadoEn: resuelta?.fila.clasificadoEn?.toISOString() ?? null,
    };
  });

  const totalAbsorcion = Money.sum(componentes.map((componente) => Money.of(componente.importeAbsorcion)));
  const motivos = componentes.flatMap((componente) => {
    if (componente.comportamientoVolumen === null) {
      return [`Falta clasificar frente al volumen el rubro ${componente.etiqueta}.`];
    }
    if (componente.comportamientoVolumen === 'SEMIFIJO') {
      return [`El rubro ${componente.etiqueta} es semifijo y todavía no tiene separado su tramo variable.`];
    }
    return [];
  });
  if (input.unidadesVendidas <= 0) {
    motivos.push('Falta una cantidad vendida mayor a cero para obtener el costo variable unitario.');
  }

  const base = {
    precioUnitario: Money.of(input.precioUnitario).toNumber(),
    unidadesVendidas: input.unidadesVendidas,
    totalAbsorcion: totalAbsorcion.toNumber(),
    componentes,
  };
  if (motivos.length > 0) {
    return {
      incompleta: true,
      ...base,
      costoVariableTotal: null,
      costoVariableUnitario: null,
      contribucionMarginalUnitaria: null,
      motivos,
    };
  }

  const costoVariableTotal = Money.sum(
    componentes
      .filter((componente) => componente.comportamientoVolumen === 'VARIABLE')
      .map((componente) => Money.of(componente.importeAbsorcion)),
  );
  const costoVariableUnitario = costoVariableTotal.divide(input.unidadesVendidas);
  return {
    incompleta: false,
    ...base,
    costoVariableTotal: costoVariableTotal.toNumber(),
    costoVariableUnitario: costoVariableUnitario.toNumber(),
    contribucionMarginalUnitaria: Money.of(input.precioUnitario).subtract(costoVariableUnitario).toNumber(),
  };
}
