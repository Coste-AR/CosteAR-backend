import { describe, it, expect } from 'vitest';
import {
  calcWorkingDays,
  calcITCS,
  calcDirectLabor,
  calcDepartmentMod,
  DESTINO_COSTO_CAPACIDAD_OCIOSA,
  type DirectLaborConfig,
} from '@/domain/calculations/direct-labor.js';
import { Percentage } from '@/domain/value-objects/percentage.js';

/**
 * Ground truth: hoja "2-MOD Ejemplo" del Excel v3.0.
 * Verifica la metodología completa de la cátedra (días → IAP → ITCS → tarifa).
 */

// Configuración idéntica al ejemplo del Excel.
const example: DirectLaborConfig = {
  workingDays: {
    totalDaysPerYear: 365,
    unpaidAbsence: { sundays: 52, saturdays: 52, unjustifiedAbsences: 3, holidaysOnWeekend: 4 },
    paidAbsence: { holidays: 19, vacations: 14, sickness: 5, specialLeaves: 2, workAccidents: 1 },
  },
  itcs: {
    derivationBase: 0.27,
    fixedArt: 0.015,
    uncertainRemunerative: [
      { name: 'Premio por Productividad', coefficient: 0.03 },
      { name: 'Antigüedad', coefficient: 0.04 },
      { name: 'Premio por Asistencia Perfecta', coefficient: 0.02 },
    ],
    uncertainNonRemunerative: [
      { name: 'Ropa de trabajo', coefficient: 0.01 },
      { name: 'Viandas / comedor', coefficient: 0.015 },
      { name: 'Medicamentos', coefficient: 0.005 },
    ],
  },
  departments: [
    { name: 'Departamento Productivo 1', basicRemuneration: 4500000, hoursWorked: 12000 },
    { name: 'Departamento Productivo 2', basicRemuneration: 3200000, hoursWorked: 9000 },
    { name: 'Departamento Productivo 3', basicRemuneration: 2800000, hoursWorked: 8000 },
  ],
};

describe('Hoja 2 — Mano de Obra Directa', () => {
  describe('A) Distribución de días', () => {
    const r = calcWorkingDays(example.workingDays);

    it('Total ausentismo no pago = (52+52+3)−4 = 103', () => {
      expect(r.totalUnpaidAbsence.toNumber()).toBe(103);
    });

    it('Días totales a pagar = 365 − 103 = 262', () => {
      expect(r.daysToPayFor.toNumber()).toBe(262);
    });

    it('Total ausentismo pago = 19+14+5+2+1 = 41', () => {
      expect(r.totalPaidAbsence.toNumber()).toBe(41);
    });

    it('Días de trabajo efectivo = 262 − 41 = 221', () => {
      expect(r.effectiveWorkDays.toNumber()).toBe(221);
    });

    it('IAP = 41/221 ≈ 18,55 %', () => {
      expect(r.iap.toPercent()).toBeCloseTo(18.552, 2);
    });
  });

  describe('C) ITCS', () => {
    const days = calcWorkingDays(example.workingDays);
    const itcs = calcITCS(example.itcs, days.iap);

    it('Cargas ciertas = 0.27 + 0.015 + 1/12 + 0.0225 ≈ 39,08 %', () => {
      expect(itcs.certainCharges.toPercent()).toBeCloseTo(39.083, 2);
    });

    it('Inciertas no remunerativas = 1+1.5+0.5 = 3 %', () => {
      expect(itcs.uncertainNonRemunerative.toPercent()).toBeCloseTo(3, 3);
    });

    it('ITCS total ≈ 79,99 % (valor del Excel)', () => {
      expect(itcs.itcs.toPercent()).toBeCloseTo(79.99, 1);
    });
  });

  describe('Caso 2 — Solo IAP (sin premios ni antigüedad)', () => {
    // Premios productividad/antigüedad/asistencia = 0; resto igual al Caso 1.
    const itcs2 = calcITCS(
      {
        derivationBase: 0.27,
        fixedArt: 0.015,
        uncertainRemunerative: [],
        uncertainNonRemunerative: [
          { name: 'Ropa de trabajo', coefficient: 0.01 },
          { name: 'Viandas / comedor', coefficient: 0.015 },
          { name: 'Medicamentos', coefficient: 0.005 },
        ],
      },
      calcWorkingDays(example.workingDays).iap,
    );

    it('B40 = solo IAP ≈ 18,55 %', () => {
      expect(itcs2.uncertainRemunerativeCoefs.toPercent()).toBeCloseTo(18.552, 2);
    });

    it('F40 = IAP × 0,375833 ≈ 6,97 %', () => {
      expect(itcs2.derivedCharges.toPercent()).toBeCloseTo(6.9725, 2);
    });

    it('ITCS ≈ 67,61 %', () => {
      expect(itcs2.itcs.toPercent()).toBeCloseTo(67.6078, 2);
    });
  });

  describe('Caso 3 — Mínimo (sin ausentismo pago, sin inciertas)', () => {
    // IAP = 0 porque ausentismo pago = 0; todos los premios y no remun. = 0.
    const minDays = calcWorkingDays({
      totalDaysPerYear: 365,
      unpaidAbsence: { sundays: 52, saturdays: 52, unjustifiedAbsences: 3, holidaysOnWeekend: 4 },
      paidAbsence: { holidays: 0, vacations: 0, sickness: 0, specialLeaves: 0, workAccidents: 0 },
    });

    const itcs3 = calcITCS(
      {
        derivationBase: 0.27,
        fixedArt: 0.015,
        uncertainRemunerative: [],
        uncertainNonRemunerative: [],
      },
      minDays.iap,
    );

    it('IAP = 0 cuando ausentismo pago = 0', () => {
      expect(minDays.iap.toPercent()).toBe(0);
    });

    it('ITCS = solo cargas ciertas ≈ 39,08 % (piso del índice)', () => {
      expect(itcs3.itcs.toPercent()).toBeCloseTo(39.083, 2);
    });

    it('B40 = F40 = B47 = 0', () => {
      expect(itcs3.uncertainRemunerativeCoefs.toPercent()).toBe(0);
      expect(itcs3.derivedCharges.toPercent()).toBe(0);
      expect(itcs3.uncertainNonRemunerative.toPercent()).toBe(0);
    });
  });

  describe('D) Costo y tarifa por departamento', () => {
    const r = calcDirectLabor(example);

    it('aplica el ITCS sobre las remuneraciones básicas', () => {
      const d1 = r.departments[0]!;
      // 4.500.000 × (1 + 0.7999) ≈ 8.099.600
      expect(d1.totalMod.toNumber()).toBeCloseTo(8099600, -2);
      // Tarifa = total / 12000 HH
      expect(d1.hourlyRate.toNumber()).toBeCloseTo(674.97, 0);
    });

    it('costo total MOD = Σ de los tres departamentos', () => {
      // 10.500.000 (básicas) × (1 + ITCS 79,99 %) con precisión decimal exacta.
      expect(r.totalMod.toNumber()).toBeCloseTo(18898986.03, 1);
    });

    it('expone el detalle de días e ITCS', () => {
      expect(r.workingDays.effectiveWorkDays.toNumber()).toBe(221);
      expect(r.itcs.itcs.toPercent()).toBeCloseTo(79.99, 1);
    });
  });
});

// ---------------------------------------------------------------------------
// E) Capacidad ociosa — presencia en fábrica vs horas netas productivas
// ---------------------------------------------------------------------------

/**
 * Caso de la auditoría: un departamento con $942.500 de costo total de MOD,
 * 180 horas PAGADAS (presencia en fábrica) y 160 horas NETAS PRODUCTIVAS.
 *
 * ITCS cero para que el costo total sea exactamente la remuneración cargada y
 * los números del caso se lean sin ruido: lo que se verifica acá es la
 * separación de horas, no el índice de cargas sociales (que ya tiene sus tests).
 */
const AUDITORIA = { name: 'Armado', basicRemuneration: 942500, hoursWorked: 180 };

describe('Hoja 2 — Capacidad ociosa (Clase 10)', () => {
  describe('Caso auditoría — 180 hs pagadas, 160 hs netas productivas', () => {
    const r = calcDepartmentMod({ ...AUDITORIA, productiveHours: 160 }, Percentage.zero());

    it('horas ociosas = presencia 180 − netas productivas 160 = 20 hs', () => {
      expect(r.idleCapacity.paidHours.toNumber()).toBe(180);
      expect(r.idleCapacity.productiveHours.toNumber()).toBe(160);
      expect(r.idleCapacity.idleHours.toNumber()).toBe(20);
      expect(r.idleCapacity.hasIdleCapacity).toBe(true);
    });

    it('la tarifa aplicada a las órdenes divide por las HORAS PRODUCTIVAS = $5.236,11/h', () => {
      // 837.777,78 (MOD imputable) ÷ 160 hs netas productivas.
      expect(r.hourlyRate.toNumber()).toBeCloseTo(5236.11, 2);
    });

    it('el costo de las 20 hs ociosas queda AISLADO en $104.722,22', () => {
      expect(r.idleCapacity.idleCost.toNumber()).toBeCloseTo(104722.22, 2);
    });

    it('MOD imputable a órdenes = $837.777,78 — las horas ociosas no entran', () => {
      expect(r.idleCapacity.applicableMod.toNumber()).toBeCloseTo(837777.78, 2);
    });

    it('nada se pierde ni se duplica: imputable + ocioso = costo total MOD', () => {
      const suma = r.idleCapacity.applicableMod.add(r.idleCapacity.idleCost);
      expect(suma.toNumber()).toBe(r.totalMod.toNumber());
      expect(r.totalMod.toNumber()).toBe(942500);
    });

    it('la tarifa × horas productivas reconstruye el MOD imputable', () => {
      const reconstruido = r.hourlyRate.multiply(r.idleCapacity.productiveHours);
      expect(reconstruido.toNumber()).toBeCloseTo(837777.78, 2);
    });
  });

  describe('RETROCOMPATIBILIDAD — una estructura sin `productiveHours` calcula igual que siempre', () => {
    // Exactamente el mismo departamento, con y sin el campo nuevo en su forma
    // "no hay ociosidad". Ninguna de las dos puede moverse respecto del histórico.
    const legado = calcDepartmentMod(AUDITORIA, Percentage.zero());
    const explicito = calcDepartmentMod(
      { ...AUDITORIA, productiveHours: 180 },
      Percentage.zero(),
    );

    it('sin el campo: tarifa = costo total ÷ horas pagadas (fórmula histórica)', () => {
      expect(legado.hourlyRate.toNumber()).toBeCloseTo(5236.11, 2);
      expect(legado.totalMod.toNumber()).toBe(942500);
    });

    it('sin el campo NO hay horas ociosas ni costo ocioso', () => {
      expect(legado.idleCapacity.idleHours.toNumber()).toBe(0);
      expect(legado.idleCapacity.idleCost.isZero()).toBe(true);
      expect(legado.idleCapacity.hasIdleCapacity).toBe(false);
    });

    it('sin el campo, el MOD imputable es el costo total: nada sale del producto', () => {
      expect(legado.idleCapacity.applicableMod.toNumber()).toBe(legado.totalMod.toNumber());
    });

    it('declarar todas las horas como productivas da lo mismo que no declararlas', () => {
      expect(explicito.hourlyRate.toNumber()).toBe(legado.hourlyRate.toNumber());
      expect(explicito.idleCapacity.idleCost.toNumber()).toBe(0);
    });

    it('la tarifa del ejemplo de la cátedra no se movió (674,97 con 12.000 HH)', () => {
      const r = calcDirectLabor(example);
      expect(r.departments[0]!.hourlyRate.toNumber()).toBeCloseTo(674.97, 0);
      expect(r.totalMod.toNumber()).toBeCloseTo(18898986.03, 1);
      expect(r.idleCapacity.hasIdleCapacity).toBe(false);
      expect(r.idleCapacity.idleCost.isZero()).toBe(true);
    });
  });

  describe('Bordes', () => {
    it('horas productivas > horas pagadas se recortan: no existen horas ociosas negativas', () => {
      const r = calcDepartmentMod(
        { ...AUDITORIA, productiveHours: 500 },
        Percentage.zero(),
      );
      expect(r.idleCapacity.productiveHours.toNumber()).toBe(180);
      expect(r.idleCapacity.idleHours.toNumber()).toBe(0);
      expect(r.idleCapacity.idleCost.isZero()).toBe(true);
    });

    it('cero horas pagadas: tarifa cero y sin costo ocioso (no divide por cero)', () => {
      const r = calcDepartmentMod(
        { name: 'Vacío', basicRemuneration: 100000, hoursWorked: 0 },
        Percentage.zero(),
      );
      expect(r.hourlyRate.isZero()).toBe(true);
      expect(r.idleCapacity.idleCost.isZero()).toBe(true);
    });

    it('cero horas productivas: TODA la presencia es ociosa y no se imputa nada', () => {
      const r = calcDepartmentMod({ ...AUDITORIA, productiveHours: 0 }, Percentage.zero());
      expect(r.idleCapacity.idleHours.toNumber()).toBe(180);
      expect(r.idleCapacity.idleCost.toNumber()).toBe(942500);
      expect(r.idleCapacity.applicableMod.isZero()).toBe(true);
      expect(r.hourlyRate.isZero()).toBe(true);
    });
  });

  describe('Consolidado de la hoja + punto de decisión del destino contable', () => {
    const config: DirectLaborConfig = {
      ...example,
      departments: [
        { name: 'Corte', basicRemuneration: 942500, hoursWorked: 180, productiveHours: 160 },
        { name: 'Acabado', basicRemuneration: 500000, hoursWorked: 100 },
      ],
    };
    const r = calcDirectLabor({ ...config, itcs: { ...config.itcs, derivationBase: 0, fixedArt: 0, sacFraction: 0, uncertainRemunerative: [], uncertainNonRemunerative: [] }, workingDays: { ...config.workingDays, paidAbsence: { holidays: 0, vacations: 0, sickness: 0, specialLeaves: 0, workAccidents: 0 } } });

    it('suma horas y costos ociosos de todos los departamentos', () => {
      expect(r.idleCapacity.paidHours.toNumber()).toBe(280);
      expect(r.idleCapacity.productiveHours.toNumber()).toBe(260);
      expect(r.idleCapacity.idleHours.toNumber()).toBe(20);
      expect(r.idleCapacity.hasIdleCapacity).toBe(true);
    });

    it('costo completo = imputable + ocioso (la hoja cierra)', () => {
      expect(r.idleCapacity.fullMod.toNumber()).toBe(1442500);
      expect(
        r.idleCapacity.applicableMod.add(r.idleCapacity.idleCost).toNumber(),
      ).toBe(1442500);
      expect(r.idleCapacity.idleCost.toNumber()).toBeCloseTo(104722.22, 2);
    });

    it('el destino contable vigente deja el estado de costos como hoy: totalMod = costo completo', () => {
      // Mientras la decisión de producto no esté tomada, `totalMod` (lo que entra
      // al estado de costos) NO se mueve. El costo ocioso está aislado y visible,
      // pero no cambia todavía el costo del producto ni el margen.
      expect(r.idleCapacity.destination).toBe('absorbido-en-el-producto');
      expect(DESTINO_COSTO_CAPACIDAD_OCIOSA).toBe('absorbido-en-el-producto');
      expect(r.totalMod.toNumber()).toBe(r.idleCapacity.fullMod.toNumber());
    });
  });
});
