import { describe, it, expect } from 'vitest';
import { populateDirectLabor } from '@/application/validaciones/cost-structure-populator.js';
import { calcITCS } from '@/domain/calculations/direct-labor.js';
import { Percentage } from '@/domain/value-objects/percentage.js';

/**
 * D-2 — Cargas sociales inciertas que llegan desde un documento analizado por la IA.
 *
 * Regla de la cátedra (clase 8): de las inciertas, SOLO las remunerativas generan
 * cargas derivadas. Si una carga no remunerativa (uniformes, viandas) entra como
 * remunerativa, el ITCS se infla con derivadas que no corresponden → el costo miente.
 *
 * Por eso la IA solo EXTRAE (nombre + coeficiente) y el SISTEMA CLASIFICA con el
 * catálogo. Estos tests fijan ese contrato.
 */

const emptyConfig = {
  workingDays: {
    totalDaysPerYear: 365,
    unpaidAbsence: { sundays: 52, saturdays: 52, unjustifiedAbsences: 0, holidaysOnWeekend: 0 },
    paidAbsence: { holidays: 0, vacations: 0, sickness: 0, specialLeaves: 0, workAccidents: 0 },
  },
  itcs: {
    derivationBase: 0.27,
    fixedArt: 0.015,
    uncertainRemunerative: [] as { name: string; coefficient: number }[],
    uncertainNonRemunerative: [] as { name: string; coefficient: number }[],
  },
  departments: [],
};

const clone = () => JSON.parse(JSON.stringify(emptyConfig));

describe('D-2 — la IA extrae las cargas inciertas, el sistema las clasifica', () => {
  it('manda cada concepto a la lista que dice el catálogo (no a la que diga la IA)', () => {
    const cfg = populateDirectLabor(clone(), {
      present: true,
      itcs: {
        uncertainCharges: [
          { name: 'Premio por asistencia perfecta', coefficient: 0.02 },
          { name: 'Premio por productividad', coefficient: 0.03 },
          { name: 'Uniformes', coefficient: 0.01 },
          { name: 'Viandas', coefficient: 0.015 },
        ],
      },
    });

    expect(cfg.itcs?.uncertainRemunerative?.map((r) => r.name)).toEqual([
      'Premio por asistencia perfecta',
      'Premio por productividad',
    ]);
    expect(cfg.itcs?.uncertainNonRemunerative?.map((r) => r.name)).toEqual(['Uniformes', 'Viandas']);
  });

  it('los dos premios NO se pisan entre sí (antes chocaban por las 3 primeras letras)', () => {
    const cfg = populateDirectLabor(clone(), {
      present: true,
      itcs: {
        uncertainCharges: [
          { name: 'Premio Asistencia Perfecta', coefficient: 0.02 },
          { name: 'Premio Productividad', coefficient: 0.03 },
        ],
      },
    });

    expect(cfg.itcs?.uncertainRemunerative).toHaveLength(2);
    expect(cfg.itcs?.uncertainRemunerative?.[1]?.coefficient).toBe(0.03);
  });

  it('si un documento viejo traía "uniformes" como remunerativo, el catálogo lo corrige', () => {
    const cfg = populateDirectLabor(clone(), {
      present: true,
      itcs: {
        // Formato anterior a D-2: la IA metía todo en la lista de remunerativas.
        uncertainRemunerative: [
          { name: 'Ropa de trabajo', coefficient: 0.01 },
          { name: 'Antigüedad', coefficient: 0.04 },
        ],
      },
    });

    expect(cfg.itcs?.uncertainRemunerative?.map((r) => r.name)).toEqual(['Antigüedad']);
    expect(cfg.itcs?.uncertainNonRemunerative?.map((r) => r.name)).toEqual(['Ropa de trabajo']);
  });

  it('no pisa lo que ya cargó el costista, ni lo cambia de lista por su cuenta', () => {
    const current = clone();
    current.itcs.uncertainRemunerative = [{ name: 'Antigüedad', coefficient: 0.05 }];
    // El costista decidió (a mano) tratar las comisiones como NO remunerativas.
    current.itcs.uncertainNonRemunerative = [{ name: 'Comisiones', coefficient: 0.02 }];

    const cfg = populateDirectLabor(current, {
      present: true,
      itcs: {
        uncertainCharges: [
          { name: 'antiguedad', coefficient: 0.09 },   // otro coeficiente
          { name: 'Comisiones', coefficient: 0.07 },   // el catálogo diría "remunerativa"
        ],
      },
    });

    expect(cfg.itcs?.uncertainRemunerative).toEqual([{ name: 'Antigüedad', coefficient: 0.05 }]);
    expect(cfg.itcs?.uncertainNonRemunerative).toEqual([{ name: 'Comisiones', coefficient: 0.02 }]);
  });

  it('el ausentismo (IAP/YAP) no se carga como concepto: lo calcula el motor', () => {
    const cfg = populateDirectLabor(clone(), {
      present: true,
      itcs: { uncertainCharges: [{ name: 'IAP (ausentismo pago)', coefficient: 0.2175 }] },
    });

    expect(cfg.itcs?.uncertainRemunerative).toHaveLength(0);
    expect(cfg.itcs?.uncertainNonRemunerative).toHaveLength(0);
  });

  it('un concepto desconocido va a NO remunerativa (no infla el costo con derivadas)', () => {
    const cfg = populateDirectLabor(clone(), {
      present: true,
      itcs: { uncertainCharges: [{ name: 'Plus convenio XY-2026', coefficient: 0.02 }] },
    });

    expect(cfg.itcs?.uncertainNonRemunerative).toEqual([
      { name: 'Plus convenio XY-2026', coefficient: 0.02 },
    ]);
  });

  it('AL CENTAVO: clasificar bien los uniformes evita inflar el ITCS 1,88 puntos', () => {
    const cfg = populateDirectLabor(clone(), {
      present: true,
      itcs: { uncertainCharges: [{ name: 'Uniformes', coefficient: 0.05 }] },
    });

    // Sin ausentismo pago, el IAP es 0 → si NADA es remunerativo, no hay derivadas.
    const bien = calcITCS(
      {
        derivationBase: 0.27,
        fixedArt: 0.015,
        uncertainRemunerative: cfg.itcs!.uncertainRemunerative!,
        uncertainNonRemunerative: cfg.itcs!.uncertainNonRemunerative!,
      },
      Percentage.zero(),
    );
    expect(bien.derivedCharges.toFraction().toNumber()).toBe(0);

    // Lo que pasaba antes: el mismo concepto entraba como remunerativo.
    const mal = calcITCS(
      {
        derivationBase: 0.27,
        fixedArt: 0.015,
        uncertainRemunerative: [{ name: 'Uniformes', coefficient: 0.05 }],
        uncertainNonRemunerative: [],
      },
      Percentage.zero(),
    );

    // Derivadas de más = 5% × (0,27 + 1/12 + 0,27/12) = 5% × 37,5833% = 1,8792%.
    const infladoDeMas = mal.itcs.toFraction().minus(bien.itcs.toFraction());
    expect(infladoDeMas.toNumber()).toBeCloseTo(0.0187917, 7);
  });
});
