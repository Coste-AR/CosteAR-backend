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
    expect(CLASIFICACIONES_AVICOLA).toHaveLength(3);
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
