import { Money } from '../value-objects/money.js';

/**
 * Claves estables de los totales que ya consolida el motor de absorción.
 *
 * Las cuatro últimas son de M0-01 (plan de análisis marginal v2): además de
 * MP/MOD/CIP, el costo REAL neto de producción (renglón 7f, `netProductionCost`)
 * incluye trabajos de terceros, amortización de activos, variación presupuesto
 * y el neto de desperdicio — hasta ahora ninguno llegaba al costeo variable.
 *
 * `amortizacionActivos` tiene una regla dura propia: 🔴 R6/R8 — la
 * amortización de un bien de uso es FIJA cuando la causa es el tiempo, y
 * NUNCA puede entrar al costo variable por vía de una cuota de aplicación.
 * El guard vive en `parametros-costeo-service.ts` (rechaza con 422 si alguien
 * intenta clasificarla VARIABLE), no acá: esta capa es pura y no decide qué
 * clasificaciones se aceptan, solo qué pasa con la que ya llegó.
 */
export const CLAVES_COMPORTAMIENTO_CONTRIBUCION = {
  materiaPrima: 'comportamiento_materia_prima',
  manoObraDirecta: 'comportamiento_mano_obra_directa',
  costosIndirectos: 'comportamiento_costos_indirectos',
  variacionPresupuesto: 'comportamiento_variacion_presupuesto',
  trabajosDeTerceros: 'comportamiento_trabajos_de_terceros',
  amortizacionActivos: 'comportamiento_amortizacion_activos',
  desperdicioAlCosto: 'comportamiento_desperdicio_al_costo',
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
  /**
   * Control de suma (M0-01): el costo neto de producción real que `componentes`
   * debería sumar (`netProductionCost`, renglón 7f del Estado de Costos).
   * Opcional — sin él el comportamiento es exactamente el de antes de M0-01.
   * Con él, si `totalAbsorcion` no coincide, el resultado sale incompleto con
   * el faltante nombrado en pesos: la descomposición no puede confiarse si no
   * reconstruye el total que el motor auditado ya certificó.
   */
  totalEsperado?: number;
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
    // Un rubro en CERO no necesita clasificación: sea FIJO, VARIABLE o
    // SEMIFIJO, aporta $0 al costo variable igual. Exigirla sería fricción
    // sin beneficio — y desde M0-01 (que suma variación presupuesto, terceros,
    // amortización y desperdicio) es el caso común: la mayoría de los
    // períodos no tiene ninguno de esos cuatro, y antes de esto cada uno sin
    // clasificar dejaba la contribución marginal entera incompleta por un
    // rubro que ni siquiera participaba.
    if (componente.importeAbsorcion === 0) return [];
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
  // Control de suma (M0-01). Tolerancia de un centavo: Money opera con 2
  // decimales y una diferencia de redondeo no es una descomposición rota.
  if (input.totalEsperado !== undefined) {
    const diferencia = Money.of(input.totalEsperado).subtract(totalAbsorcion);
    if (Math.abs(diferencia.toNumber()) >= 0.01) {
      const signo = diferencia.toNumber() > 0 ? 'faltan' : 'sobran';
      motivos.push(
        `El control de suma no cierra: ${signo} $${Math.abs(diferencia.toNumber()).toFixed(2)} respecto del costo neto de producción (renglón 7f). Revisá qué componente no se está pasando, o se pasó con otro importe.`,
      );
    }
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
