import { describe, it, expect } from 'vitest';
import {
  calcularAmortizacionMensual,
  amortizaEnPeriodo,
} from '@/domain/parametros/activo-amortizable.js';
import {
  imputarDesperdicios,
  sugerirNaturaleza,
  type DesperdicioRegistrado,
} from '@/domain/calculations/desperdicio.js';
import { resolverParametro } from '@/domain/parametros/parametros-costeo.js';

/**
 * S-03 y S-04 — el plantel como activo, y el desperdicio con naturaleza declarada.
 */

// Datos del vertical avícola, coherentes con tests/domain/avicola-fixture.test.ts
const AVES = 6_300;
const COSTO_POR_AVE = 10_666.666_67;

describe('S-03 — el plantel es un activo amortizable, no un insumo del período', () => {
  it('la cuota mensual se DERIVA: (costo − residual) / vida útil = 2.800.000', () => {
    const vidaUtil = resolverParametro('vida_util_lote_meses', [], {}).valor;

    const r = calcularAmortizacionMensual(
      {
        costoAdquisicion: AVES * COSTO_POR_AVE,
        valorResidual: 0,
        vidaUtilMeses: vidaUtil,
      },
      AVES,
    );

    expect(r.cuota).toBeCloseTo(2_800_000, 0);
    expect(r.cuotaPorUnidad).toBeCloseTo(444.44, 2);
  });

  it('el error de la nota: cargar $800 por cabeza subestima 13 veces', () => {
    const bueno = calcularAmortizacionMensual({
      costoAdquisicion: AVES * COSTO_POR_AVE,
      valorResidual: 0,
      vidaUtilMeses: 24,
    });
    const malo = calcularAmortizacionMensual({
      costoAdquisicion: AVES * 800,
      valorResidual: 0,
      vidaUtilMeses: 24,
    });

    expect(malo.cuota).toBeCloseTo(210_000, 0);
    expect(bueno.cuota / malo.cuota).toBeCloseTo(13.33, 1);
  });

  it('🔒 la vida útil NO está hardcodeada: cambiar el parámetro cambia la cuota', () => {
    // Si alguien escribe 24 a mano en el cálculo, este test lo delata: con 18
    // meses la cuota tiene que subir, no quedarse igual.
    const base = { costoAdquisicion: AVES * COSTO_POR_AVE, valorResidual: 0 };

    const con24 = calcularAmortizacionMensual({ ...base, vidaUtilMeses: 24 });
    const con18 = calcularAmortizacionMensual({ ...base, vidaUtilMeses: 18 });

    expect(con18.cuota).toBeGreaterThan(con24.cuota);
    expect(con18.cuota / con24.cuota).toBeCloseTo(24 / 18, 4);
  });

  it('el valor residual (gallina de descarte) baja el monto amortizable', () => {
    const sinResidual = calcularAmortizacionMensual({
      costoAdquisicion: 1_000_000,
      valorResidual: 0,
      vidaUtilMeses: 10,
    });
    const conResidual = calcularAmortizacionMensual({
      costoAdquisicion: 1_000_000,
      valorResidual: 200_000,
      vidaUtilMeses: 10,
    });

    expect(sinResidual.cuota).toBe(100_000);
    expect(conResidual.cuota).toBe(80_000);
  });

  it('una vida útil de cero o negativa falla fuerte, no devuelve Infinity', () => {
    for (const vida of [0, -3]) {
      expect(() =>
        calcularAmortizacionMensual({
          costoAdquisicion: 100,
          valorResidual: 0,
          vidaUtilMeses: vida,
        }),
      ).toThrowError(/vida útil/i);
    }
  });

  it('un residual mayor que el costo no da amortización negativa: falla', () => {
    expect(() =>
      calcularAmortizacionMensual({
        costoAdquisicion: 100,
        valorResidual: 500,
        vidaUtilMeses: 10,
      }),
    ).toThrowError(/valor residual/i);
  });

  it('comprar el lote NO impacta el costo del período de compra', () => {
    const inicio = new Date('2026-08-01');
    const fin = new Date('2026-08-31');

    // Alta dentro del período: ese mes no amortiza.
    expect(amortizaEnPeriodo(new Date('2026-08-15'), inicio, fin)).toBe(false);
    // Alta anterior: amortiza normalmente.
    expect(amortizaEnPeriodo(new Date('2026-05-10'), inicio, fin)).toBe(true);
    // Alta posterior: todavía no existe.
    expect(amortizaEnPeriodo(new Date('2026-09-02'), inicio, fin)).toBe(false);
  });
});

describe('S-04 — el desperdicio necesita naturaleza declarada', () => {
  const merma = (o: Partial<DesperdicioRegistrado> & { concepto: string; valor: number }) =>
    ({ naturaleza: null, ...o }) as DesperdicioRegistrado;

  it('la merma NORMAL la absorben las unidades buenas, con el recupero restado (R5)', () => {
    const r = imputarDesperdicios([
      merma({ concepto: 'huevo roto', valor: 100_000, naturaleza: 'normal', valorRecupero: 20_000 }),
    ]);

    expect(r.alCosto).toBe(80_000);
    expect(r.recuperoAplicado).toBe(20_000);
    expect(r.alResultado).toBe(0);
  });

  it('la merma EXTRAORDINARIA va a resultado del período, nunca a costo', () => {
    const r = imputarDesperdicios([
      merma({ concepto: 'mortandad masiva por golpe de calor', valor: 3_000_000, naturaleza: 'extraordinaria' }),
    ]);

    expect(r.alCosto).toBe(0);
    expect(r.alResultado).toBe(3_000_000);
  });

  it('🚨 sin naturaleza declarada NO entra al cálculo: queda pendiente', () => {
    const r = imputarDesperdicios([merma({ concepto: 'mortandad', valor: 500_000 })]);

    expect(r.alCosto).toBe(0);
    expect(r.alResultado).toBe(0);
    expect(r.pendientes).toHaveLength(1);
    expect(r.pendientes[0]!.concepto).toBe('mortandad');
    // El motivo tiene que explicar por qué el sistema no decidió solo.
    expect(r.pendientes[0]!.motivo).toMatch(/normal o extraordinaria/i);
  });

  it('mezcla real de un mes: cada una a su lugar y lo dudoso aparte', () => {
    const r = imputarDesperdicios([
      merma({ concepto: 'huevo roto', valor: 100_000, naturaleza: 'normal', valorRecupero: 10_000 }),
      merma({ concepto: 'maíz húmedo', valor: 7_200_000, naturaleza: 'extraordinaria' }),
      merma({ concepto: 'desvío de consumo', valor: 300_000 }),
    ]);

    expect(r.alCosto).toBe(90_000);
    expect(r.alResultado).toBe(7_200_000);
    expect(r.pendientes).toHaveLength(1);
  });

  it('sin umbral configurado, el sistema NO sugiere naturaleza', () => {
    // Es el estado inicial a propósito: el umbral no surge del comprobante.
    expect(sugerirNaturaleza(3, null)).toBeNull();
    expect(sugerirNaturaleza(3, 0)).toBeNull();
  });

  it('con umbral configurado, sugiere pero el valor sigue siendo una sugerencia', () => {
    expect(sugerirNaturaleza(1.9, 2)).toBe('normal');
    expect(sugerirNaturaleza(5.5, 2)).toBe('extraordinaria');
  });

  it('el umbral sale del parámetro de costeo, no de una constante', () => {
    const p = resolverParametro('umbral_merma_normal_pct', [], {});
    expect(p.origen).toBe('default');
    expect(p.confirmado).toBe(false);
    // Default en 0 = sin criterio declarado = todo va a pendientes.
    expect(sugerirNaturaleza(1, p.valor)).toBeNull();
  });
});
