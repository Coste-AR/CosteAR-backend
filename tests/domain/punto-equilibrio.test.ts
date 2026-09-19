import { describe, expect, it } from 'vitest';
import { calcularContribucionMarginal, type FilaComportamiento } from '@/domain/calculations/contribucion-marginal.js';
import {
  calcularPuntoEquilibrio,
  calcularVariacionPuntoEquilibrio,
} from '@/domain/calculations/punto-equilibrio.js';

const filas: FilaComportamiento[] = [
  { id: '1', clave: 'mp', comportamientoVolumen: 'VARIABLE', structureId: 's', periodId: null, clasificadoPorUserId: 'u', clasificadoEn: new Date() },
  { id: '2', clave: 'cif', comportamientoVolumen: 'FIJO', structureId: 's', periodId: null, clasificadoPorUserId: 'u', clasificadoEn: new Date() },
];

describe('punto de equilibrio', () => {
  it('deriva costos fijos sobre contribución unitaria y conserva la fecha', () => {
    const contribucion = calcularContribucionMarginal({ precioUnitario: 10, unidadesVendidas: 5, componentes: [{ clave: 'mp', etiqueta: 'MP', importeAbsorcion: 20 }, { clave: 'cif', etiqueta: 'CIF', importeAbsorcion: 15 }], clasificaciones: filas, contexto: { structureId: 's', periodId: null } });
    expect(calcularPuntoEquilibrio(contribucion, new Date('2026-01-02T03:04:05.000Z'))).toMatchObject({ incompleta: false, tipo: 'punto', unidadesEquilibrio: 2.5, fechaUltimoRecalculo: '2026-01-02T03:04:05.000Z' });
  });

  it('AM-07: devuelve [709,09; 793,55] cuando los CIP son el único concepto sin clasificar', () => {
    const contribucion = calcularContribucionMarginal({
      precioUnitario: 500,
      unidadesVendidas: 800,
      unidadesProducidas: 1000,
      componentes: [
        { clave: 'variables_produccion', etiqueta: 'Variables de producción', importeAbsorcion: 160000 },
        { clave: 'cip', etiqueta: 'Costos indirectos de producción', importeAbsorcion: 90000 },
        { clave: 'fijos_produccion', etiqueta: 'Fijos de producción', importeAbsorcion: 100000 },
        { clave: 'gastos_comercializacion', etiqueta: 'Gastos de comercialización', importeAbsorcion: 24000, elemento: 'venta' },
        { clave: 'gastos_administracion', etiqueta: 'Gastos de administración', importeAbsorcion: 56000, elemento: 'venta' },
      ],
      clasificaciones: [
        { id: 'v', clave: 'variables_produccion', comportamientoVolumen: 'VARIABLE', structureId: null, periodId: null, clasificadoPorUserId: null, clasificadoEn: null },
        { id: 'fp', clave: 'fijos_produccion', comportamientoVolumen: 'FIJO', structureId: null, periodId: null, clasificadoPorUserId: null, clasificadoEn: null },
        { id: 'gv', clave: 'gastos_comercializacion', comportamientoVolumen: 'VARIABLE', structureId: null, periodId: null, clasificadoPorUserId: null, clasificadoEn: null },
        { id: 'ga', clave: 'gastos_administracion', comportamientoVolumen: 'FIJO', structureId: null, periodId: null, clasificadoPorUserId: null, clasificadoEn: null },
      ],
      contexto: { structureId: 'st', periodId: null },
    });

    const resultado = calcularPuntoEquilibrio(contribucion, new Date('2026-01-02T03:04:05.000Z'));
    expect(resultado).toMatchObject({
      incompleta: false,
      tipo: 'zona',
      unidadesEquilibrio: null,
      conceptosQueLaEnsanchan: [{
        clave: 'cip',
        etiqueta: 'Costos indirectos de producción',
        importe: 90000,
      }],
    });
    if (resultado.incompleta || resultado.tipo !== 'zona') throw new Error('debería devolver una zona');
    expect(resultado.qMin).toBeCloseTo(709.09, 2);
    expect(resultado.qMax).toBeCloseTo(793.55, 2);
    expect(resultado.conceptosQueLaEnsanchan[0]!.aporteAlAncho).toBeCloseTo(84.46, 2);
    expect(resultado.qMin).toBeLessThan(750);
    expect(resultado.qMax).toBeGreaterThan(750);
  });

  it('con AM-07 completamente clasificado devuelve un punto exacto de 750', () => {
    const contribucion = calcularContribucionMarginal({
      precioUnitario: 500,
      unidadesVendidas: 800,
      unidadesProducidas: 1000,
      componentes: [
        { clave: 'variables_produccion', etiqueta: 'Variables de producción', importeAbsorcion: 160000 },
        { clave: 'cip_variable', etiqueta: 'Porción variable de CIP', importeAbsorcion: 54000 },
        { clave: 'cip_fija', etiqueta: 'Porción fija de CIP', importeAbsorcion: 36000 },
        { clave: 'fijos_produccion', etiqueta: 'Fijos de producción', importeAbsorcion: 100000 },
        { clave: 'gastos_comercializacion', etiqueta: 'Gastos de comercialización', importeAbsorcion: 24000, comportamientoVolumenForzado: 'VARIABLE', elemento: 'venta' },
        { clave: 'gastos_administracion', etiqueta: 'Gastos de administración', importeAbsorcion: 56000, comportamientoVolumenForzado: 'FIJO', elemento: 'venta' },
      ],
      clasificaciones: [
        { id: 'v', clave: 'variables_produccion', comportamientoVolumen: 'VARIABLE', structureId: null, periodId: null, clasificadoPorUserId: null, clasificadoEn: null },
        { id: 'cv', clave: 'cip_variable', comportamientoVolumen: 'VARIABLE', structureId: null, periodId: null, clasificadoPorUserId: null, clasificadoEn: null },
        { id: 'cf', clave: 'cip_fija', comportamientoVolumen: 'FIJO', structureId: null, periodId: null, clasificadoPorUserId: null, clasificadoEn: null },
        { id: 'fp', clave: 'fijos_produccion', comportamientoVolumen: 'FIJO', structureId: null, periodId: null, clasificadoPorUserId: null, clasificadoEn: null },
      ],
      contexto: { structureId: 'st', periodId: null },
    });

    expect(calcularPuntoEquilibrio(contribucion, new Date())).toMatchObject({
      incompleta: false,
      tipo: 'punto',
      unidadesEquilibrio: 750,
    });
  });

  it('con ventas ausentes conserva incompleta porque la zona no se puede acotar', () => {
    const contribucion = calcularContribucionMarginal({
      precioUnitario: 500,
      unidadesVendidas: 0,
      componentes: [{ clave: 'cip', etiqueta: 'CIP', importeAbsorcion: 90000 }],
      clasificaciones: [],
      contexto: { structureId: 'st', periodId: null },
    });

    expect(calcularPuntoEquilibrio(contribucion, new Date())).toMatchObject({
      incompleta: true,
      unidadesEquilibrio: null,
    });
  });

  it('sin precio conserva incompleta aunque haya un concepto sin clasificar', () => {
    const contribucion = calcularContribucionMarginal({
      precioUnitario: 0,
      unidadesVendidas: 100,
      componentes: [{ clave: 'cip', etiqueta: 'CIP', importeAbsorcion: 90000 }],
      clasificaciones: [],
      contexto: { structureId: 'st', periodId: null },
    });

    expect(calcularPuntoEquilibrio(contribucion, new Date())).toMatchObject({
      incompleta: true,
      unidadesEquilibrio: null,
    });
  });

  it('no fabrica un número con contribución marginal no positiva', () => {
    const contribucion = calcularContribucionMarginal({ precioUnitario: 4, unidadesVendidas: 5, componentes: [{ clave: 'mp', etiqueta: 'MP', importeAbsorcion: 20 }, { clave: 'cif', etiqueta: 'CIF', importeAbsorcion: 15 }], clasificaciones: filas, contexto: { structureId: 's', periodId: null } });
    expect(calcularPuntoEquilibrio(contribucion, new Date()).unidadesEquilibrio).toBeNull();
  });

  it('suma la porción fija de un semifijo y no su importe completo', () => {
    const contribucion = calcularContribucionMarginal({
      precioUnitario: 500,
      unidadesVendidas: 800,
      unidadesProducidas: 1000,
      componentes: [
        { clave: 'mp', etiqueta: 'MP', importeAbsorcion: 150000 },
        { clave: 'cip', etiqueta: 'CIP', importeAbsorcion: 90000 },
      ],
      clasificaciones: [
        { ...filas[0], clave: 'mp' },
        {
          ...filas[1], clave: 'cip', comportamientoVolumen: 'SEMIFIJO',
          porcionFijaSemifija: 54000, porcionVariableSemifija: 36000,
        },
      ],
      contexto: { structureId: 's', periodId: null },
    });
    // cm = 500 - (150000 + 36000) / 1000 = 314; PE = 54000 / 314.
    expect(calcularPuntoEquilibrio(contribucion, new Date()).unidadesEquilibrio).toBe(171.97);
  });

  it('mide el movimiento porcentual absoluto contra la corrida anterior', () => {
    const contribucion = calcularContribucionMarginal({ precioUnitario: 12, unidadesVendidas: 6, componentes: [{ clave: 'mp', etiqueta: 'MP', importeAbsorcion: 18 }, { clave: 'cif', etiqueta: 'CIF', importeAbsorcion: 18 }], clasificaciones: filas, contexto: { structureId: 's', periodId: null } });
    const anterior = calcularPuntoEquilibrio(contribucion, new Date('2026-01-01T00:00:00.000Z'));
    const actual = {
      ...anterior,
      unidadesEquilibrio: anterior.unidadesEquilibrio! * 1.2,
    } as typeof anterior;

    expect(calcularVariacionPuntoEquilibrio(actual, anterior)).toBeCloseTo(20);
    expect(calcularVariacionPuntoEquilibrio(anterior, { ...anterior, unidadesEquilibrio: null })).toBeNull();
  });
});
