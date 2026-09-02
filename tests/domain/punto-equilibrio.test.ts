import { describe, expect, it } from 'vitest';
import { calcularContribucionMarginal, type FilaComportamiento } from '@/domain/calculations/contribucion-marginal.js';
import { calcularPuntoEquilibrio } from '@/domain/calculations/punto-equilibrio.js';

const filas: FilaComportamiento[] = [
  { id: '1', clave: 'mp', comportamientoVolumen: 'VARIABLE', structureId: 's', periodId: null, clasificadoPorUserId: 'u', clasificadoEn: new Date() },
  { id: '2', clave: 'cif', comportamientoVolumen: 'FIJO', structureId: 's', periodId: null, clasificadoPorUserId: 'u', clasificadoEn: new Date() },
];

describe('punto de equilibrio', () => {
  it('deriva costos fijos sobre contribución unitaria y conserva la fecha', () => {
    const contribucion = calcularContribucionMarginal({ precioUnitario: 10, unidadesVendidas: 5, componentes: [{ clave: 'mp', etiqueta: 'MP', importeAbsorcion: 20 }, { clave: 'cif', etiqueta: 'CIF', importeAbsorcion: 15 }], clasificaciones: filas, contexto: { structureId: 's', periodId: null } });
    expect(calcularPuntoEquilibrio(contribucion, new Date('2026-01-02T03:04:05.000Z'))).toMatchObject({ incompleta: false, unidadesEquilibrio: 2.5, fechaUltimoRecalculo: '2026-01-02T03:04:05.000Z' });
  });

  it('no fabrica un número con contribución marginal no positiva', () => {
    const contribucion = calcularContribucionMarginal({ precioUnitario: 4, unidadesVendidas: 5, componentes: [{ clave: 'mp', etiqueta: 'MP', importeAbsorcion: 20 }, { clave: 'cif', etiqueta: 'CIF', importeAbsorcion: 15 }], clasificaciones: filas, contexto: { structureId: 's', periodId: null } });
    expect(calcularPuntoEquilibrio(contribucion, new Date()).unidadesEquilibrio).toBeNull();
  });
});
