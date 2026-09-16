import { Money } from '../value-objects/money.js';

/**
 * Claves estables de los totales que ya consolida el motor de absorción.
 *
 * Las cuatro de M0-01 (plan de análisis marginal v2): además de MP/MOD/CIP, el
 * costo REAL neto de producción (renglón 7f, `netProductionCost`) incluye
 * trabajos de terceros, amortización de activos, variación presupuesto y el
 * neto de desperdicio — hasta ahora ninguno llegaba al costeo variable.
 *
 * `amortizacionActivos` tiene una regla dura propia: 🔴 R6/R8 — la
 * amortización de un bien de uso es FIJA cuando la causa es el tiempo, y
 * NUNCA puede entrar al costo variable por vía de una cuota de aplicación.
 * El guard vive en `parametros-costeo-service.ts` (rechaza con 422 si alguien
 * intenta clasificarla VARIABLE), no acá: esta capa es pura y no decide qué
 * clasificaciones se aceptan, solo qué pasa con la que ya llegó.
 *
 * Las dos últimas son de M2-01: gastos de no fabricación (`CostElement.VENTA`,
 * hasta ahora sin dónde cargarse). Las dos llegan con
 * `comportamientoVolumenForzado` — a diferencia de MP/MOD/CIP, no necesitan
 * clasificación humana: un gasto variable de comercialización "por unidad
 * vendida" es variable por cómo se mide, y un gasto de administración del
 * período es fijo del período, sin que nadie tenga que decidirlo.
 */
export const CLAVES_COMPORTAMIENTO_CONTRIBUCION = {
  materiaPrima: 'comportamiento_materia_prima',
  manoObraDirecta: 'comportamiento_mano_obra_directa',
  costosIndirectos: 'comportamiento_costos_indirectos',
  variacionPresupuesto: 'comportamiento_variacion_presupuesto',
  trabajosDeTerceros: 'comportamiento_trabajos_de_terceros',
  amortizacionActivos: 'comportamiento_amortizacion_activos',
  desperdicioAlCosto: 'comportamiento_desperdicio_al_costo',
  gastosComercializacion: 'comportamiento_gastos_comercializacion',
  gastosAdministracion: 'comportamiento_gastos_administracion',
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
  /**
   * M2-01. Para componentes cuyo comportamiento es fijo/variable por
   * DEFINICIÓN, no por decisión del costista (un "gasto variable de
   * comercialización por unidad vendida" es variable por cómo se mide, no
   * porque alguien lo haya elegido). Cuando viene, se usa DIRECTO y se
   * saltea la cascada de `ParametroCosteo` — ni siquiera hace falta que
   * exista una fila, y si existiera una (por error o por intento de
   * anularlo) no gana: lo forzado es una propiedad del componente, no una
   * clasificación que se pueda pisar.
   */
  comportamientoVolumenForzado?: ComportamientoVolumen;
  /**
   * M0-02. De qué elemento del costo es este componente: `'produccion'`
   * (MP/MOD/CIP y los cuatro renglones de M0-01 — todo lo que compone el
   * costo REAL de producción) divide por unidades PRODUCIDAS; `'venta'`
   * (`CostElement.VENTA`, M2-01) divide por unidades VENDIDAS. Default
   * `'produccion'` cuando se omite: todos los componentes de antes de M0-02
   * eran de producción, así que no hace falta tocar ningún llamador viejo.
   */
  elemento?: 'produccion' | 'venta';
}

export interface ContribucionMarginalInput {
  precioUnitario: number;
  unidadesVendidas: number;
  /**
   * M0-02. Unidades PRODUCIDAS del período — divisor del costo variable de
   * producción. Opcional: si falta o es `<= 0`, se cae a `unidadesVendidas`
   * (mismo criterio que `detail.unitCost.basadoEn` del motor auditado) y el
   * resultado lo dice con `basadoEn: 'vendidas'`. No se falla, se avisa.
   */
  unidadesProducidas?: number | null;
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
  /** M0-02. El valor efectivamente usado: `unidadesProducidas` si es válido, si no `unidadesVendidas` (ver `basadoEn`). */
  unidadesProducidas: number;
  /** M0-02. `'vendidas'` cuando no había cantidad producida cargada — mismo significado que `detail.unitCost.basadoEn`. */
  basadoEn: 'producidas' | 'vendidas';
  totalAbsorcion: number;
  costoVariableTotal: number;
  /** M0-02. Componentes de elemento 'produccion' ÷ `unidadesProducidas`. */
  costoVariableUnitarioProduccion: number;
  /** M0-02. Componentes de elemento 'venta' ÷ `unidadesVendidas`. */
  costoVariableUnitarioComercializacion: number;
  /** Suma de los dos anteriores — mismo campo de siempre, mismo nombre. */
  costoVariableUnitario: number;
  contribucionMarginalUnitaria: number;
  componentes: TrazaComponenteContribucion[];
}

export interface ContribucionMarginalIncompleta {
  incompleta: true;
  precioUnitario: number;
  unidadesVendidas: number;
  unidadesProducidas: number;
  basadoEn: 'producidas' | 'vendidas';
  totalAbsorcion: number;
  costoVariableTotal: null;
  costoVariableUnitarioProduccion: null;
  costoVariableUnitarioComercializacion: null;
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
    if (componente.comportamientoVolumenForzado) {
      return {
        ...componente,
        comportamientoVolumen: componente.comportamientoVolumenForzado,
        origen: null,
        parametroId: null,
        clasificadoPorUserId: null,
        clasificadoEn: null,
      };
    }
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

  // M0-02. Sin cantidad producida cargada, se cae a vendidas — mismo criterio
  // que `detail.unitCost.basadoEn` del motor auditado (`calculate.ts`). No es
  // un motivo que bloquee: el costo variable de producción se puede seguir
  // calculando, solo que con un divisor distinto del ideal.
  const hayProducidas = input.unidadesProducidas != null && input.unidadesProducidas > 0;
  const unidadesProducidas = hayProducidas ? input.unidadesProducidas! : input.unidadesVendidas;
  const basadoEn: 'producidas' | 'vendidas' = hayProducidas ? 'producidas' : 'vendidas';

  const base = {
    precioUnitario: Money.of(input.precioUnitario).toNumber(),
    unidadesVendidas: input.unidadesVendidas,
    unidadesProducidas,
    basadoEn,
    totalAbsorcion: totalAbsorcion.toNumber(),
    componentes,
  };
  if (motivos.length > 0) {
    return {
      incompleta: true,
      ...base,
      costoVariableTotal: null,
      costoVariableUnitarioProduccion: null,
      costoVariableUnitarioComercializacion: null,
      costoVariableUnitario: null,
      contribucionMarginalUnitaria: null,
      motivos,
    };
  }

  // M0-02. Issue #88 reaparecido en esta capa: todo dividía por vendidas,
  // incluido el costo variable de PRODUCCIÓN. Ahora cada elemento divide por
  // la cantidad que le corresponde — `elemento` default 'produccion' cubre
  // MP/MOD/CIP y los cuatro renglones de M0-01 sin que ningún llamador viejo
  // tenga que declararlo.
  const variablesDeProduccion = componentes.filter(
    (c) => c.comportamientoVolumen === 'VARIABLE' && (c.elemento ?? 'produccion') === 'produccion',
  );
  const variablesDeComercializacion = componentes.filter(
    (c) => c.comportamientoVolumen === 'VARIABLE' && c.elemento === 'venta',
  );
  const costoVariableProduccionTotal = Money.sum(variablesDeProduccion.map((c) => Money.of(c.importeAbsorcion)));
  const costoVariableComercializacionTotal = Money.sum(variablesDeComercializacion.map((c) => Money.of(c.importeAbsorcion)));
  const costoVariableTotal = costoVariableProduccionTotal.add(costoVariableComercializacionTotal);
  const costoVariableUnitarioProduccion = costoVariableProduccionTotal.divide(unidadesProducidas);
  // `input.unidadesVendidas > 0` está garantizado acá: si no, el motivo de
  // arriba ya hubiera vuelto `incompleta` antes de llegar a este punto.
  const costoVariableUnitarioComercializacion = costoVariableComercializacionTotal.divide(input.unidadesVendidas);
  const costoVariableUnitario = costoVariableUnitarioProduccion.add(costoVariableUnitarioComercializacion);
  return {
    incompleta: false,
    ...base,
    costoVariableTotal: costoVariableTotal.toNumber(),
    costoVariableUnitarioProduccion: costoVariableUnitarioProduccion.toNumber(),
    costoVariableUnitarioComercializacion: costoVariableUnitarioComercializacion.toNumber(),
    costoVariableUnitario: costoVariableUnitario.toNumber(),
    contribucionMarginalUnitaria: Money.of(input.precioUnitario).subtract(costoVariableUnitario).toNumber(),
  };
}
