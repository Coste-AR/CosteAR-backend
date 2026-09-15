import { describe, expect, it } from 'vitest';
import {
  CLASIFICACIONES_AVICOLA,
  resolverComportamiento,
  type FilaComportamiento,
} from '@/domain/parametros/parametros-costeo.js';

const ESTRUCTURA = 'estructura-1';
const PERIODO = 'periodo-1';

function fila(
  clave: string,
  comportamientoVolumen: 'VARIABLE' | 'FIJO' | 'SEMIFIJO',
  over: Partial<FilaComportamiento> = {},
): FilaComportamiento {
  return {
    clave,
    comportamientoVolumen,
    periodId: null,
    structureId: null,
    confirmado: false,
    clasificadoPorUserId: null,
    clasificadoEn: null,
    ...over,
  };
}

describe('A-04 — propuesta de clasificación por rubro', () => {
  it('propone sólo materia prima y deja los rubros grises sin inventar', () => {
    const mp = resolverComportamiento('comportamiento_materia_prima', [], {});
    expect(mp).toMatchObject({ comportamientoVolumen: 'VARIABLE', origen: 'default', confirmado: false });
    for (const clave of ['comportamiento_mano_obra_directa', 'comportamiento_costos_indirectos']) {
      expect(resolverComportamiento(clave, [], {}).comportamientoVolumen).toBeNull();
    }
  });

  /**
   * M0-01 (plan de análisis marginal v2). Los cuatro renglones del costo REAL
   * que se suman al costeo variable —variación presupuesto, trabajos de
   * terceros, amortización de activos, desperdicio neto— nacen SIN clasificar,
   * igual que MOD y CIP: ninguno tiene una relación tan directa con el volumen
   * como la materia prima como para proponerla sola. La amortización tiene una
   * regla dura propia (R6/R8, nunca VARIABLE), pero esa regla se hace cumplir
   * con un rechazo en `parametros-costeo-service.ts`, no con un default acá.
   */
  it('las cuatro claves de M0-01 también nacen sin proponer, como MOD y CIP', () => {
    for (const clave of [
      'comportamiento_variacion_presupuesto',
      'comportamiento_trabajos_de_terceros',
      'comportamiento_amortizacion_activos',
      'comportamiento_desperdicio_al_costo',
    ]) {
      expect(resolverComportamiento(clave, [], {}).comportamientoVolumen).toBeNull();
    }
    expect(CLASIFICACIONES_AVICOLA).toHaveLength(7);
  });

  it('la elección de empresa gana sobre la propuesta y el período gana sobre empresa', () => {
    const clave = 'comportamiento_materia_prima';
    const r = resolverComportamiento(
      clave,
      [
        fila(clave, 'FIJO', { confirmado: true, clasificadoPorUserId: 'u-1', clasificadoEn: new Date() }),
        fila(clave, 'VARIABLE', {
          structureId: ESTRUCTURA,
          periodId: PERIODO,
          confirmado: true,
          clasificadoPorUserId: 'u-2',
          clasificadoEn: new Date(),
        }),
      ],
      { structureId: ESTRUCTURA, periodId: PERIODO },
    );
    expect(r).toMatchObject({ comportamientoVolumen: 'VARIABLE', origen: 'periodo', confirmado: true });
  });
});
