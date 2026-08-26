import { describe, it, expect } from 'vitest';
import { Money } from '@/domain/value-objects/money.js';
import {
  primaryProration,
  type CostCenter,
  type IndirectCostConcept,
} from '@/domain/calculations/indirect-costs.js';
import { CalcError } from '@/domain/errors/domain-error.js';

/**
 * ASIGNACIÓN DIRECTA en el prorrateo primario (issue #93, hallazgo L2).
 *
 * Doctrina (clase 12 de la cátedra, "Prorrateo Primario: Asignación Directa a
 * Departamentos"): «el importe ya viene asignado por departamento; no se busca
 * base ni se calcula cuota», y «la suma de los cinco departamentos debe dar
 * $4.538».
 *
 * Son dos reglas, no una, y la segunda es la que le da sentido a la primera:
 * si no se renormaliza, un descuadre ya no se disimula solo — hay que cazarlo.
 */
describe('Prorrateo primario — asignación directa', () => {
  const centers: CostCenter[] = [
    { id: 'corte', name: 'Corte', type: 'productive' },
    { id: 'mecanizado', name: 'Mecanizado', type: 'productive' },
    { id: 'mantenimiento', name: 'Mantenimiento', type: 'service' },
  ];

  /** Los cinco departamentos del práctico de la clase 12. */
  const cinco: CostCenter[] = [
    ...centers,
    { id: 'almacen', name: 'Almacén', type: 'service' },
    { id: 'oftecnica', name: 'Oficina Técnica', type: 'service' },
  ];

  it('usa los importes declarados tal cual, sin renormalizar por el total', () => {
    const concepts: IndirectCostConcept[] = [
      {
        name: 'Seguro Incendio',
        amount: { fixed: Money.of(500), variable: Money.zero() },
        allocationMode: 'direct',
        distribution: { corte: 250, mecanizado: 200, mantenimiento: 50 },
      },
    ];

    const r = primaryProration(centers, concepts);

    expect(r.corte!.fixed.toNumber()).toBe(250);
    expect(r.mecanizado!.fixed.toNumber()).toBe(200);
    expect(r.mantenimiento!.fixed.toNumber()).toBe(50);
  });

  it('EL CASO DEL ISSUE #93: no reescribe 250.000 en 300.000 — corta con 422', () => {
    // Alquiler de $600.000 con importes que suman $500.000. El motor viejo
    // renormalizaba y le daba 300.000 a Corte en vez de los 250.000 declarados,
    // sin avisar de la diferencia de 100.000. Ahora el descuadre es un error.
    const concepts: IndirectCostConcept[] = [
      {
        name: 'Alquiler',
        amount: { fixed: Money.of(600000), variable: Money.zero() },
        allocationMode: 'direct',
        distribution: { corte: 250000, mecanizado: 200000, mantenimiento: 50000 },
      },
    ];

    expect(() => primaryProration(centers, concepts)).toThrow(CalcError);

    try {
      primaryProration(centers, concepts);
      expect.unreachable('tenía que lanzar');
    } catch (e) {
      const err = e as CalcError;
      // 422, no 500: es un dato mal cargado, no una falla del sistema.
      expect(err.statusCode).toBe(422);
      // El mensaje tiene que traer la diferencia: sin el número, el costista
      // sabe que algo no cierra pero no por cuánto ni dónde mirar.
      expect(err.message).toContain('Alquiler');
      expect(err.message).toContain('500000.00');
      expect(err.message).toContain('600000.00');
      expect(err.message).toContain('100000.00');
      expect(err.message).toContain('de menos');
    }
  });

  it('también corta cuando los importes se pasan del total', () => {
    expect(() =>
      primaryProration(centers, [
        {
          name: 'Papeles y Útiles',
          amount: { fixed: Money.of(200), variable: Money.zero() },
          allocationMode: 'direct',
          distribution: { corte: 150, mecanizado: 100 },
        },
      ]),
    ).toThrow(/de más/);
  });

  it('el control es al centavo: un desvío de 0,01 no pasa', () => {
    expect(() =>
      primaryProration(centers, [
        {
          name: 'Seguro Incendio',
          amount: { fixed: Money.of(320), variable: Money.zero() },
          allocationMode: 'direct',
          distribution: { corte: 80, mecanizado: 120, mantenimiento: 119.99 },
        },
      ]),
    ).toThrow(CalcError);
  });

  it('EL CASO DE LA CÁTEDRA: Seguro Incendio, $320 en cinco departamentos', () => {
    // Clase 12, verbatim: «Seguro Incendio: $320, fija, asignación directa —
    // Corte $80, Mecanizado $120, Mantenimiento $50, Almacén $50, Of. Técnica $20».
    // Cierra exacto: 80 + 120 + 50 + 50 + 20 = 320.
    const r = primaryProration(cinco, [
      {
        name: 'Seguro Incendio',
        amount: { fixed: Money.of(320), variable: Money.zero() },
        allocationMode: 'direct',
        distribution: {
          corte: 80,
          mecanizado: 120,
          mantenimiento: 50,
          almacen: 50,
          oftecnica: 20,
        },
      },
    ]);

    expect(r.corte!.fixed.toNumber()).toBe(80);
    expect(r.mecanizado!.fixed.toNumber()).toBe(120);
    expect(r.oftecnica!.fixed.toNumber()).toBe(20);

    const total = Object.values(r).reduce((acc, fv) => acc.add(fv.fixed), Money.zero());
    expect(total.toNumber()).toBe(320);
  });

  it('el control caza el descuadre de la propia clase 12 (Mano de Obra Indirecta)', () => {
    // Hallazgo al escribir estos tests: los importes que la clase 12 da para
    // «Mano de Obra Indirecta y Cargas Sociales» NO satisfacen la verificación
    // que la propia clase enuncia dos líneas más abajo.
    //
    //   Declarado: $4.538
    //   Corte 493 + Mecanizado 493 + Mantenimiento 592 + Almacén 1.480 +
    //   Of. Técnica 1.080 = 4.138  →  faltan exactamente 400
    //
    // El $4.538 aparece dos veces en la clase (también como presupuesto en el
    // análisis de variaciones), así que lo que está mal es alguno de los cinco
    // importes, no el total. Queda fijado como test: el día que se corrija la
    // nota de la bóveda, este test avisa que hay que actualizarlo.
    expect(() =>
      primaryProration(cinco, [
        {
          name: 'Mano de Obra Indirecta y Cargas Sociales',
          amount: { fixed: Money.of(4538), variable: Money.zero() },
          allocationMode: 'direct',
          distribution: {
            corte: 493,
            mecanizado: 493,
            mantenimiento: 592,
            almacen: 1480,
            oftecnica: 1080,
          },
        },
      ]),
    ).toThrow(/400\.00 de menos/);
  });

  it('una cuenta variable cae entera del lado variable', () => {
    const r = primaryProration(centers, [
      {
        name: 'Materiales Indirectos Consumidos',
        amount: { fixed: Money.zero(), variable: Money.of(2233) },
        allocationMode: 'direct',
        distribution: { corte: 1533, mecanizado: 700 },
      },
    ]);

    expect(r.corte!.variable.toNumber()).toBe(1533);
    expect(r.corte!.fixed.toNumber()).toBe(0);
    expect(r.mecanizado!.variable.toNumber()).toBe(700);
  });

  it('no acepta un centro que no existe', () => {
    expect(() =>
      primaryProration(centers, [
        {
          name: 'X',
          amount: { fixed: Money.of(100), variable: Money.zero() },
          allocationMode: 'direct',
          distribution: { fantasma: 100 },
        },
      ]),
    ).toThrow(/centro inexistente/);
  });

  it('REGRESIÓN: percent y base siguen renormalizando igual que antes', () => {
    // El mismo reparto que en 'direct' daría 250/200/50. En 'percent' los
    // valores son pesos relativos, así que 600.000 se reparte 50/40/10 %.
    const base: Omit<IndirectCostConcept, 'allocationMode'> = {
      name: 'Alquiler',
      amount: { fixed: Money.of(600000), variable: Money.zero() },
      distribution: { corte: 250000, mecanizado: 200000, mantenimiento: 50000 },
    };

    for (const modo of ['percent', 'base', undefined] as const) {
      const r = primaryProration(centers, [{ ...base, allocationMode: modo }]);
      expect(r.corte!.fixed.toNumber()).toBe(300000);
      expect(r.mecanizado!.fixed.toNumber()).toBe(240000);
      expect(r.mantenimiento!.fixed.toNumber()).toBe(60000);
    }
  });
});
