import { describe, it, expect } from 'vitest';
import { Money } from '@/domain/value-objects/money.js';
import {
  secondaryProrationStepwise,
  type CostCenter,
  type PrimaryProrationResult,
} from '@/domain/calculations/indirect-costs.js';

/**
 * FX4 — Prorrateo secundario ESCALONADO con orden de cierre (criterio A.3.c).
 *
 * Ejercita la regla dura de la cátedra: "cerrado no recibe", discriminando
 * SIEMPRE fijo/variable, con dos centros de servicio interdependientes
 * (Oficina Técnica y Mantenimiento) y dos productivos (Corte, Mecanizado).
 *
 * Números de la cátedra que este test bloquea (verificados a mano en la spec):
 *   - Mantenimiento acumula 2.400,25 f / 2.482 v tras recibir de Of. Técnica
 *     (163,25 f / 30 v), porque Mantenimiento aún NO cerró.
 *   - Base de Mantenimiento: 750 hs máquina → cuota 3,2003 f / 3,3093 v.
 *   - Reparte a Corte (225 hs) y Mecanizado (525 hs).
 *   - Los tres servicios quedan en 0. No se pierde ni un centavo.
 *
 * Nota de redondeo (criterio A.4 — "redondear AL FINAL, nunca en pasos
 * intermedios"): el motor acumula en precisión plena y recién redondea al
 * exponer. Por eso Corte fijo = 2.400,25 × 0,3 = 720,075 (el motor NO
 * pre-redondea la cuota a 3,2003 y multiplica). La presentación de la cátedra
 * que muestra 720,07 proviene de redondear la cuota a 4 decimales antes de
 * multiplicar; el árbol de derivación puede mostrar esa cuota redondeada como
 * ayuda visual, pero el número que fluye al costo es el de precisión plena.
 */
describe('FX4 — Prorrateo secundario escalonado', () => {
  const centers: CostCenter[] = [
    { id: 'oftecnica', name: 'Oficina Técnica', type: 'service' },
    { id: 'mantenimiento', name: 'Mantenimiento', type: 'service' },
    { id: 'corte', name: 'Corte', type: 'productive' },
    { id: 'mecanizado', name: 'Mecanizado', type: 'productive' },
  ];

  // Primario ya calculado (prorrateo primario, no es objeto de este test).
  const primary: PrimaryProrationResult = {
    oftecnica: { fixed: Money.of(653), variable: Money.of(120) },
    mantenimiento: { fixed: Money.of(2237), variable: Money.of(2452) },
    corte: { fixed: Money.zero(), variable: Money.zero() },
    mecanizado: { fixed: Money.zero(), variable: Money.zero() },
  };

  // Orden de cierre: Of. Técnica primero (Mantenimiento aún puede recibir),
  // luego Mantenimiento.
  const result = secondaryProrationStepwise(centers, primary, [
    {
      serviceCenterId: 'oftecnica',
      // Of. Técnica reparte 3:1 → Mecanizado (productivo) y Mantenimiento (servicio abierto).
      distribution: { mecanizado: 3, mantenimiento: 1 },
      baseName: '% dedicación',
    },
    {
      serviceCenterId: 'mantenimiento',
      distribution: { corte: 225, mecanizado: 525 },
      baseName: 'horas máquina',
    },
  ]);

  it('Of. Técnica entrega 163,25 f / 30 v a Mantenimiento (servicio abierto lo recibe)', () => {
    const step0 = result.steps[0]!;
    expect(step0.toTargets.mantenimiento!.fixed.toDecimal().toNumber()).toBe(163.25);
    expect(step0.toTargets.mantenimiento!.variable.toDecimal().toNumber()).toBe(30);
    expect(step0.toTargets.mecanizado!.fixed.toDecimal().toNumber()).toBe(489.75);
    expect(step0.toTargets.mecanizado!.variable.toDecimal().toNumber()).toBe(90);
  });

  it('Mantenimiento acumula 2.400,25 f / 2.482 v antes de cerrar', () => {
    const step1 = result.steps[1]!;
    expect(step1.distributed.fixed.toDecimal().toNumber()).toBe(2400.25);
    expect(step1.distributed.variable.toDecimal().toNumber()).toBe(2482);
  });

  it('Base 750 hs máquina → cuota 3,2003 f / 3,3093 v (4 decimales, como la cátedra)', () => {
    const step1 = result.steps[1]!;
    expect(step1.totalBaseFixed.toNumber()).toBe(750);
    expect(step1.quotaFixed.toDecimalPlaces(4).toNumber()).toBe(3.2003);
    expect(step1.quotaVariable.toDecimalPlaces(4).toNumber()).toBe(3.3093);
  });

  it('Mantenimiento reparte a Corte (225) y Mecanizado (525) en precisión plena', () => {
    const step1 = result.steps[1]!;
    // 2.400,25 × 225/750 = 720,075 ; × 525/750 = 1.680,175 (criterio A.4)
    expect(step1.toTargets.corte!.fixed.toDecimal().toNumber()).toBe(720.075);
    expect(step1.toTargets.mecanizado!.fixed.toDecimal().toNumber()).toBe(1680.175);
    // 2.482 × 0,3 = 744,60 ; × 0,7 = 1.737,40
    expect(step1.toTargets.corte!.variable.toDecimal().toNumber()).toBe(744.6);
    expect(step1.toTargets.mecanizado!.variable.toDecimal().toNumber()).toBe(1737.4);
  });

  it('Los tres servicios quedan en 0 al final', () => {
    expect(result.byCenter.oftecnica!.fixed.toNumber()).toBe(0);
    expect(result.byCenter.oftecnica!.variable.toNumber()).toBe(0);
    expect(result.byCenter.mantenimiento!.fixed.toNumber()).toBe(0);
    expect(result.byCenter.mantenimiento!.variable.toNumber()).toBe(0);
  });

  it('No se pierde ni un centavo: Σ productivos = Σ primario', () => {
    const totalFixed = result.byCenter.corte!.fixed.add(result.byCenter.mecanizado!.fixed);
    const totalVar = result.byCenter.corte!.variable.add(result.byCenter.mecanizado!.variable);
    // Σ primario fijo = 653 + 2237 = 2890 ; variable = 120 + 2452 = 2572
    expect(totalFixed.toDecimal().toNumber()).toBe(2890);
    expect(totalVar.toDecimal().toNumber()).toBe(2572);
  });

  it('CERRADO NO RECIBE: repartir a un servicio ya cerrado lanza error accionable', () => {
    expect(() =>
      secondaryProrationStepwise(centers, primary, [
        { serviceCenterId: 'oftecnica', distribution: { mecanizado: 1 } },
        // Mantenimiento intenta devolver a Of. Técnica, que YA cerró → error.
        { serviceCenterId: 'mantenimiento', distribution: { oftecnica: 1, corte: 1 } },
      ]),
    ).toThrow(/ya cerró y no puede recibir/);
  });

  it('un servicio no puede repartirse a sí mismo', () => {
    expect(() =>
      secondaryProrationStepwise(centers, primary, [
        { serviceCenterId: 'mantenimiento', distribution: { mantenimiento: 1, corte: 1 } },
      ]),
    ).toThrow(/no puede repartirse a sí mismo/);
  });
});
