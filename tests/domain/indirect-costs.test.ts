import { describe, it, expect } from 'vitest';
import { Money } from '@/domain/value-objects/money.js';
import {
  primaryProration,
  secondaryProration,
  calcPredeterminedQuota,
  calcVarianceAnalysis,
  checkVarianceIdentity,
  TOLERANCIA_IDENTIDAD_VARIACIONES,
  type CostCenter,
  type IndirectCostConcept,
} from '@/domain/calculations/indirect-costs.js';
import { MissingInputError } from '@/domain/errors/calculation-errors.js';

describe('Hoja 3 — Costos Indirectos de Producción (CIP)', () => {
  const centers: CostCenter[] = [
    { id: 'prod1', name: 'Productivo 1', type: 'productive' },
    { id: 'prod2', name: 'Productivo 2', type: 'productive' },
    { id: 'serv1', name: 'Mantenimiento', type: 'service' },
  ];

  describe('Prorrateo primario', () => {
    it('reparte cada concepto según su base sin perder monto', () => {
      const concepts: IndirectCostConcept[] = [
        {
          name: 'Alquiler',
          amount: { fixed: Money.of(100000), variable: Money.zero() },
          distribution: { prod1: 50, prod2: 30, serv1: 20 }, // m²
        },
        {
          name: 'Energía',
          amount: { fixed: Money.zero(), variable: Money.of(60000) },
          distribution: { prod1: 40, prod2: 50, serv1: 10 }, // kWh
        },
      ];

      const r = primaryProration(centers, concepts);

      // Alquiler: 100000 repartido 50/30/20 → 50000 / 30000 / 20000
      expect(r.prod1!.fixed.toNumber()).toBe(50000);
      expect(r.prod2!.fixed.toNumber()).toBe(30000);
      expect(r.serv1!.fixed.toNumber()).toBe(20000);
      // Energía: 60000 variable repartido 40/50/10 → 24000 / 30000 / 6000
      expect(r.prod1!.variable.toNumber()).toBe(24000);
      expect(r.serv1!.variable.toNumber()).toBe(6000);

      // Conservación: la suma repartida iguala el total original.
      const totalFixed = r.prod1!.fixed
        .add(r.prod2!.fixed)
        .add(r.serv1!.fixed);
      expect(totalFixed.toNumber()).toBe(100000);
    });

    it('lanza error si la base total de un concepto es cero', () => {
      expect(() =>
        primaryProration(centers, [
          {
            name: 'X',
            amount: { fixed: Money.of(100), variable: Money.zero() },
            distribution: { prod1: 0, prod2: 0, serv1: 0 },
          },
        ]),
      ).toThrow(/base de distribución total = 0/);
    });
  });

  describe('Prorrateo secundario', () => {
    it('transfiere el servicio a los productivos y deja el servicio en cero', () => {
      const primary = {
        prod1: { fixed: Money.of(50000), variable: Money.of(24000) },
        prod2: { fixed: Money.of(30000), variable: Money.of(30000) },
        serv1: { fixed: Money.of(20000), variable: Money.of(6000) },
      };

      const r = secondaryProration(centers, primary, [
        { serviceCenterId: 'serv1', toProductive: { prod1: 60, prod2: 40 } },
      ]);

      // serv1 fijo 20000 → 60/40 → +12000 / +8000
      expect(r.prod1!.fixed.toNumber()).toBe(62000); // 50000 + 12000
      expect(r.prod2!.fixed.toNumber()).toBe(38000); // 30000 + 8000
      // serv1 variable 6000 → 60/40 → +3600 / +2400
      expect(r.prod1!.variable.toNumber()).toBe(27600); // 24000 + 3600
      expect(r.prod2!.variable.toNumber()).toBe(32400); // 30000 + 2400

      // El resultado solo contiene productivos.
      expect(r.serv1).toBeUndefined();
    });
  });

  describe('Cuotas predeterminadas', () => {
    it('Cpf y Cpv = presupuesto / capacidad normal', () => {
      const quota = calcPredeterminedQuota(
        { fixed: Money.of(120000), variable: Money.of(80000) },
        1000, // bp = 1000 horas-máquina
      );
      expect(quota.fixedQuota.toNumber()).toBe(120); // 120000/1000
      expect(quota.variableQuota.toNumber()).toBe(80); // 80000/1000
      expect(quota.totalQuota.toNumber()).toBe(200);
    });

    it('retorna cuotas en cero si bp es cero', () => {
      const quota = calcPredeterminedQuota({ fixed: Money.of(1), variable: Money.of(1) }, 0);
      expect(quota.fixedQuota.toNumber()).toBe(0);
      expect(quota.variableQuota.toNumber()).toBe(0);
      expect(quota.totalQuota.toNumber()).toBe(0);
    });
  });

  describe('Análisis de variaciones', () => {
    const cipBudget = { fixed: Money.of(120000), variable: Money.of(80000) };
    const bp = 1000;
    const quota = calcPredeterminedQuota(cipBudget, bp);

    it('cumple la regla de control: VarPres + VarVol = −(Sobre/Sub)', () => {
      const actualActivity = 900; // se produjo menos que lo normal
      const actualCip = Money.of(195000);

      const v = calcVarianceAnalysis(quota, cipBudget, bp, actualActivity, actualCip);

      // CIP aplicado = 200 × 900 = 180000
      expect(v.cipApplied.toNumber()).toBe(180000);

      // Control de la cátedra: VarPres + VarVol = −(over/under)
      const sumVar = v.budgetVariance.add(v.volumeVariance);
      expect(sumVar.toNumber()).toBe(-v.overUnderApplied.toNumber());
    });

    it('descompone correctamente las dos variaciones', () => {
      const actualActivity = 900;
      const actualCip = Money.of(195000);
      const v = calcVarianceAnalysis(quota, cipBudget, bp, actualActivity, actualCip);

      // Presupuesto ajustado a 900: fijo 120000 + (80×900) = 192000
      // Var presupuesto = real − ajustado = 195000 − 192000 = 3000 (desfavorable)
      expect(v.budgetVariance.toNumber()).toBe(3000);

      // Var volumen = cuota fija 120 × (1000 − 900) = 12000 (desfavorable, ociosidad)
      expect(v.volumeVariance.toNumber()).toBe(12000);

      // Sobre/sub = aplicado − real = 180000 − 195000 = −15000 (subaplicado)
      expect(v.overUnderApplied.toNumber()).toBe(-15000);
      // 3000 + 12000 = 15000 = −(−15000) ✓
    });
  });

  /**
   * CAPACIDAD NORMAL EN 0 — el 500 crudo que se reprodujo en auditoría.
   *
   * `PUT` de Costos Indirectos con `normalCapacity: 0` devolvía 200, y el
   * `POST /calculate` posterior moría con "División por cero en cálculo
   * monetario" (`Money.divide`) desde `calcVarianceAnalysis`. Ahora el motor
   * corta antes con un 422 accionable que nombra el centro.
   */
  describe('Capacidad normal en 0', () => {
    const cipBudget = { fixed: Money.of(120000), variable: Money.of(80000) };

    it('la cuota predeterminada sigue devolviendo ceros (comportamiento intacto)', () => {
      const quota = calcPredeterminedQuota(cipBudget, 0);
      expect(quota.fixedQuota.toNumber()).toBe(0);
      expect(quota.variableQuota.toNumber()).toBe(0);
      expect(quota.totalQuota.toNumber()).toBe(0);
    });

    it('el análisis de variaciones tira MissingInputError 422, no un Error crudo', () => {
      const quota = calcPredeterminedQuota(cipBudget, 0);
      try {
        calcVarianceAnalysis(quota, cipBudget, 0, 900, Money.of(195000), 'Corte');
        expect.fail('debía tirar MissingInputError');
      } catch (err) {
        expect(err).toBeInstanceOf(MissingInputError);
        expect((err as MissingInputError).statusCode).toBe(422);
        expect((err as MissingInputError).code).toBe('MISSING_INPUT');
        // Nunca el mensaje crudo de Money.
        expect((err as MissingInputError).message).not.toContain('División por cero');
      }
    });

    it('el mensaje nombra el centro y no expone el id interno', () => {
      const quota = calcPredeterminedQuota(cipBudget, 0);
      expect(() =>
        calcVarianceAnalysis(quota, cipBudget, 0, 900, Money.of(195000), 'Corte'),
      ).toThrow(/«Corte»/);
      expect(() =>
        calcVarianceAnalysis(quota, cipBudget, 0, 900, Money.of(195000), 'Corte'),
      ).toThrow(/capacidad normal/i);
    });

    it('sin nombre de centro cae a un genérico, nunca a un id', () => {
      const quota = calcPredeterminedQuota(cipBudget, 0);
      expect(() => calcVarianceAnalysis(quota, cipBudget, 0, 900, Money.of(195000))).toThrow(
        /«un centro productivo»/,
      );
    });

    it('con capacidad normal > 0 no cambia nada', () => {
      const quota = calcPredeterminedQuota(cipBudget, 1000);
      expect(() =>
        calcVarianceAnalysis(quota, cipBudget, 1000, 900, Money.of(195000), 'Corte'),
      ).not.toThrow();
    });
  });

/**
 * CONTROL DE CÁTEDRA: var. presupuesto + var. volumen = −(sobre/sub-aplicación).
 *
 * La regla estaba escrita en la documentación de `calcVarianceAnalysis` desde
 * el primer día y el motor NUNCA la corría. Mismo patrón que
 * `checkRawMaterialConsistency`, que también existía apagada y fue un defecto
 * real cuando se la encontró.
 *
 * Los dos centros de abajo son el caso D02 de la auditoría de Órdenes del
 * 20-08-2026, y están elegidos a propósito: uno cierra exacto y el otro deja el
 * centavo que motivó el hallazgo.
 */
describe('Identidad de las variaciones (control de cátedra)', () => {
  /**
   * D02 · "Terminación" — el centro cuyas cuotas tienen decimales periódicos.
   *
   * Presupuesto 218.000 fijo / 234.500 variable, capacidad normal 3.000,
   * actividad real 2.800, CIP real 430.000. De ahí salen:
   *
   *     cuota fija      72,666666…   cuota variable  78,166666…
   *     var. presupuesto  −6.866,67   var. volumen    14.533,33
   *     sobre/sub aplic.  −7.666,67
   *
   * y el control de cátedra da 7.666,66 contra 7.666,67.
   */
  const terminacion = () => {
    const budget = { fixed: Money.of(218000), variable: Money.of(234500) };
    const quota = calcPredeterminedQuota(budget, 3000);
    return calcVarianceAnalysis(quota, budget, 3000, 2800, Money.of(430000), 'Terminación');
  };

  it('reproduce el caso Terminación: 7.666,66 contra 7.666,67', () => {
    const v = terminacion();

    // Los tres números tal como los serializa la API.
    expect(v.budgetVariance.toNumber()).toBe(-6866.67);
    expect(v.volumeVariance.toNumber()).toBe(14533.33);
    expect(v.overUnderApplied.toNumber()).toBe(-7666.67);

    // El control de la cátedra, escrito como lo escribe la cátedra.
    const suma = v.budgetVariance.toNumber() + v.volumeVariance.toNumber();
    expect(suma).toBeCloseTo(7666.66, 2);
    expect(-v.overUnderApplied.toNumber()).toBe(7666.67);
  });

  it('Terminación PASA el control: el centavo está dentro de la tolerancia', () => {
    const check = checkVarianceIdentity(terminacion());

    // Un centavo exacto: es el residuo de redondear tres veces por separado,
    // no un error de cálculo. El motor mantiene 28 dígitos internamente.
    expect(check.difference.toNumber()).toBe(-0.01);
    expect(check.matches).toBe(true);
  });

  it('D02 · "Inyección" cierra exacto, sin residuo', () => {
    // Mismo caso, el centro cuyas cuotas dan redondas: 382.000/445.500 sobre
    // capacidad 4.000, actividad real 3.600, CIP real 800.000.
    const budget = { fixed: Money.of(382000), variable: Money.of(445500) };
    const quota = calcPredeterminedQuota(budget, 4000);
    const v = calcVarianceAnalysis(quota, budget, 4000, 3600, Money.of(800000), 'Inyección');

    expect(v.budgetVariance.toNumber()).toBe(17050);
    expect(v.volumeVariance.toNumber()).toBe(38200);
    expect(v.overUnderApplied.toNumber()).toBe(-55250);

    const check = checkVarianceIdentity(v);
    expect(check.difference.toNumber()).toBe(0);
    expect(check.matches).toBe(true);
  });

  it('una diferencia de $1,00 SÍ rompe el control', () => {
    // Se parte del caso que cierra exacto y se desplaza UNA de las tres
    // variaciones un peso: es lo que pasaría si alguien tocara una fórmula sin
    // tocar las otras dos. Eso no es redondeo y tiene que avisar.
    const budget = { fixed: Money.of(382000), variable: Money.of(445500) };
    const quota = calcPredeterminedQuota(budget, 4000);
    const sano = calcVarianceAnalysis(quota, budget, 4000, 3600, Money.of(800000), 'Inyección');

    const roto = { ...sano, budgetVariance: sano.budgetVariance.add(Money.of(1)) };
    const check = checkVarianceIdentity(roto);

    expect(check.matches).toBe(false);
    expect(check.difference.toNumber()).toBe(1);
  });

  it('la tolerancia es exactamente un centavo: $0,02 ya no pasa', () => {
    // Fija el borde. Sin esto, alguien podría aflojar la tolerancia a $0,10
    // "para que deje de molestar" y ningún test se enteraría.
    const budget = { fixed: Money.of(382000), variable: Money.of(445500) };
    const quota = calcPredeterminedQuota(budget, 4000);
    const sano = calcVarianceAnalysis(quota, budget, 4000, 3600, Money.of(800000), 'Inyección');

    expect(TOLERANCIA_IDENTIDAD_VARIACIONES).toBe(0.01);

    const justo = { ...sano, volumeVariance: sano.volumeVariance.add(Money.of(0.01)) };
    expect(checkVarianceIdentity(justo).matches).toBe(true);

    const pasado = { ...sano, volumeVariance: sano.volumeVariance.add(Money.of(0.02)) };
    expect(checkVarianceIdentity(pasado).matches).toBe(false);
  });

  it('un centro pendiente de cierre (todo en cero) cierra la identidad solo', () => {
    // Documenta el borde honesto: sin actividad real ni CIP real, las tres
    // variaciones valen cero y el control da verde. Verde acá NO significa
    // "el cierre del mes está verificado".
    const cero = {
      cipApplied: Money.zero(),
      overUnderApplied: Money.zero(),
      budgetVariance: Money.zero(),
      volumeVariance: Money.zero(),
    };
    expect(checkVarianceIdentity(cero).matches).toBe(true);
  });
});

});
