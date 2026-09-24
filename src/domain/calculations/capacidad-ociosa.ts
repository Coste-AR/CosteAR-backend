export interface CentroCipOcioso {
  budgetVariance: number;
  volumeVariance: number;
  overUnderApplied: number;
}

export function calcularCapacidadOciosa(input: {
  capacidadNormal: number | null;
  actividadReal: number | null;
  contribucionMarginalUnitaria: number | null;
  centrosCip: CentroCipOcioso[];
}) {
  const variacionPresupuesto = input.centrosCip.reduce((total, centro) => total + centro.budgetVariance, 0);
  const variacionVolumen = input.centrosCip.reduce((total, centro) => total + centro.volumeVariance, 0);
  const sobreSubaplicacion = input.centrosCip.reduce((total, centro) => total + centro.overUnderApplied, 0);
  const diferencia = variacionPresupuesto + variacionVolumen + sobreSubaplicacion;

  const faltantes = [
    input.capacidadNormal === null ? 'capacidad normal en unidades' : null,
    input.actividadReal === null ? 'actividad real en unidades' : null,
    input.contribucionMarginalUnitaria === null ? 'contribución marginal unitaria completa' : null,
  ].filter((valor): valor is string => valor !== null);

  return {
    ociosidadR22: faltantes.length > 0
      ? { valor: null, motivo: `No se puede calcular R22: falta ${faltantes.join(', ')}.` }
      : {
          valor: Math.max(0, input.capacidadNormal! - input.actividadReal!) * input.contribucionMarginalUnitaria!,
          motivo: null,
        },
    cip: {
      variacionPresupuesto,
      variacionVolumen,
      controlDosVias: {
        sobreSubaplicacion,
        diferencia,
        cierra: Math.abs(diferencia) < 1e-6,
        formula: 'presupuesto + volumen = -(aplicado - real)',
      },
    },
    tresVias: {
      bloqueada: true as const,
      motivo: 'Requiere una base estándar para la producción real (O1-02); el motor hoy solo conoce actividad real y capacidad normal.',
    },
  };
}
