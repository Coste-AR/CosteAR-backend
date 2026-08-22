import { describe, it, expect } from 'vitest';
import {
  allocateByPhysicalUnits,
  allocateByTechnicalYield,
  allocateByMarketValue,
  allocateByNetRealizableValue,
  allocateJointCosts,
  type JointProduct,
} from '@/domain/calculations/joint-costs.js';
import { ProcessValidationError } from '@/domain/errors/calculation-errors.js';

/** Redondea a `dp` decimales para comparar contra los números impresos de la cátedra. */
const round = (value: { toDecimalPlaces: (dp: number) => { toNumber: () => number } }, dp = 2): number =>
  value.toDecimalPlaces(dp).toNumber();

describe('Costos conjuntos — reparto entre productos del punto de separación (B11)', () => {
  describe('Ancla M1 · unidades físicas (costo uniforme por unidad)', () => {
    it('reproduce EXACTO $60/kg y $150.000 / $180.000 / $240.000 (control $570.000)', () => {
      // Buenas 9.500 (A 2.500 + B 3.000 + C 4.000); el desperdicio 500 NO se lista.
      const products: JointProduct[] = [
        { productName: 'A', unitsObtained: 2500 },
        { productName: 'B', unitsObtained: 3000 },
        { productName: 'C', unitsObtained: 4000 },
      ];

      const r = allocateByPhysicalUnits(products, 570000);

      // $60/kg uniforme en las tres líneas.
      expect(r.lines.map((l) => l.unitCost.toNumber())).toEqual([60, 60, 60]);
      expect(r.lines.map((l) => l.allocatedCost.toNumber())).toEqual([150000, 180000, 240000]);
      // Control: Σ asignados = costo conjunto total.
      expect(r.totalAllocated.toNumber()).toBe(570000);
    });
  });

  describe('Ancla M3 · valor de mercado en el punto de separación', () => {
    it('reproduce EXACTO A $100.000 ($40/kg), B $170.000 ($56,67/kg), C $300.000 ($75/kg)', () => {
      const products: JointProduct[] = [
        { productName: 'A', unitsObtained: 2500, marketPrice: 120 }, // 300.000
        { productName: 'B', unitsObtained: 3000, marketPrice: 170 }, // 510.000
        { productName: 'C', unitsObtained: 4000, marketPrice: 225 }, // 900.000
      ];

      const r = allocateByMarketValue(products, 570000);

      // Base = valor de mercado; total $1.710.000.
      expect(r.lines.map((l) => l.allocationBase.toNumber())).toEqual([300000, 510000, 900000]);
      expect(r.lines.map((l) => l.allocatedCost.toNumber())).toEqual([100000, 170000, 300000]);
      expect(round(r.lines[0].unitCost)).toBe(40);
      expect(round(r.lines[1].unitCost)).toBe(56.67); // 56,666… redondeado
      expect(round(r.lines[2].unitCost)).toBe(75);
      expect(r.totalAllocated.toNumber()).toBe(570000);
    });
  });

  describe('Ancla M4 · valor neto de realización (VNR)', () => {
    it('reproduce EXACTO los VNR y los costos asignados (control $110.000)', () => {
      // var 3 % sobre el valor de venta; fija $10/kg.
      const products: JointProduct[] = [
        { productName: 'A', unitsObtained: 200, marketPrice: 300, sellingCostVarPct: 0.03, sellingCostFixedPerUnit: 10 },
        { productName: 'B', unitsObtained: 300, marketPrice: 400, sellingCostVarPct: 0.03, sellingCostFixedPerUnit: 10 },
        { productName: 'C', unitsObtained: 400, marketPrice: 500, sellingCostVarPct: 0.03, sellingCostFixedPerUnit: 10 },
      ];

      const r = allocateByNetRealizableValue(products, 110000);

      // VNR: A 60.000−(1.800+2.000)=56.200; B 120.000−(3.600+3.000)=113.400; C 200.000−(6.000+4.000)=190.000.
      expect(r.lines.map((l) => l.allocationBase.toNumber())).toEqual([56200, 113400, 190000]);
      // Costos asignados: A $17.191,32; B $34.688,54; C $58.120,13 (la cátedra imprime B/C en pesos enteros).
      expect(round(r.lines[0].allocatedCost)).toBe(17191.32);
      expect(round(r.lines[1].allocatedCost)).toBe(34688.54);
      expect(round(r.lines[2].allocatedCost)).toBe(58120.13);
      // Costo unitario: A $85,96/kg (la cátedra redondea B/C a $115 y $145).
      expect(round(r.lines[0].unitCost)).toBe(85.96);
      expect(round(r.lines[1].unitCost)).toBe(115.63);
      expect(round(r.lines[2].unitCost)).toBe(145.3);
      // Control $110.000 dentro de la tolerancia de redondeo.
      expect(round(r.totalAllocated)).toBe(110000);
    });
  });

  describe('Ancla M2 · factor técnico (rendimientos dados)', () => {
    it('reproduce EXACTO las participaciones 52,17 % / 4,35 % / 43,48 %', () => {
      // MP 1.000 kg; rendimientos 6 % / 0,50 % / 5 % → kilos obtenidos 60 / 5 / 50 (total 115).
      const products: JointProduct[] = [
        { productName: 'Jugo', unitsObtained: 60, yieldPct: 0.06 },
        { productName: 'Aceite', unitsObtained: 5, yieldPct: 0.005 },
        { productName: 'Cáscara', unitsObtained: 50, yieldPct: 0.05 },
      ];
      const jointCostTotal = 230000;

      const r = allocateByTechnicalYield(products, jointCostTotal);

      // Participaciones = rendimiento(p) ÷ Σ rendimientos (kg de MP se cancelan).
      expect(round(r.lines[0].participationPct.times(100))).toBe(52.17);
      expect(round(r.lines[1].participationPct.times(100))).toBe(4.35);
      expect(round(r.lines[2].participationPct.times(100))).toBe(43.48);
      // costo asignado = participación × jointCostTotal.
      expect(round(r.lines[0].allocatedCost)).toBe(round(r.lines[0].participationPct.times(jointCostTotal)));
      // Control: Σ asignados = costo conjunto total.
      expect(round(r.totalAllocated)).toBe(jointCostTotal);
    });
  });

  describe('Los 4 métodos sobre el MISMO dataset dan costos unitarios DISTINTOS', () => {
    it('el producto A recibe un costo unitario diferente con cada método', () => {
      // Un dataset con todos los campos para que los cuatro métodos corran.
      const products: JointProduct[] = [
        { productName: 'A', unitsObtained: 2500, yieldPct: 0.06, marketPrice: 120, sellingCostVarPct: 0.03, sellingCostFixedPerUnit: 10 },
        { productName: 'B', unitsObtained: 3000, yieldPct: 0.005, marketPrice: 170, sellingCostVarPct: 0.03, sellingCostFixedPerUnit: 10 },
        { productName: 'C', unitsObtained: 4000, yieldPct: 0.05, marketPrice: 225, sellingCostVarPct: 0.03, sellingCostFixedPerUnit: 10 },
      ];
      const jointCostTotal = 570000;

      const unitCostsA = (['PHYSICAL_UNITS', 'TECHNICAL_YIELD', 'MARKET_VALUE', 'NET_REALIZABLE_VALUE'] as const).map(
        (method) => allocateJointCosts(products, method, jointCostTotal).lines[0].unitCost.toNumber(),
      );

      // Los cuatro costos unitarios de A son todos distintos entre sí.
      expect(new Set(unitCostsA).size).toBe(4);
    });
  });

  describe('Controles y validación de datos rotos', () => {
    it('Σ participaciones = 100 % y Σ costos asignados = jointCostTotal', () => {
      const products: JointProduct[] = [
        { productName: 'A', unitsObtained: 2500, marketPrice: 120 },
        { productName: 'B', unitsObtained: 3000, marketPrice: 170 },
        { productName: 'C', unitsObtained: 4000, marketPrice: 225 },
      ];

      const r = allocateByMarketValue(products, 570000);

      const sumaPct = r.lines.reduce((acc, l) => acc + l.participationPct.toNumber(), 0);
      expect(sumaPct).toBeCloseTo(1, 9);
      expect(r.totalAllocated.toNumber()).toBe(570000);
    });

    it('lanza ProcessValidationError si la base de reparto total es 0 (todos los precios en 0)', () => {
      const products: JointProduct[] = [
        { productName: 'A', unitsObtained: 2500, marketPrice: 0 },
        { productName: 'B', unitsObtained: 3000, marketPrice: 0 },
      ];
      expect(() => allocateByMarketValue(products, 570000)).toThrow(ProcessValidationError);
    });

    it('lanza ProcessValidationError si falta el precio de mercado en un método que lo necesita', () => {
      const products: JointProduct[] = [
        { productName: 'A', unitsObtained: 2500, marketPrice: 120 },
        { productName: 'B', unitsObtained: 3000 }, // sin marketPrice
      ];
      expect(() => allocateByMarketValue(products, 570000)).toThrow(ProcessValidationError);
    });

    it('lanza ProcessValidationError si un VNR sale negativo (gastos > valor de venta)', () => {
      const products: JointProduct[] = [
        { productName: 'A', unitsObtained: 100, marketPrice: 10, sellingCostVarPct: 0.05, sellingCostFixedPerUnit: 20 },
      ];
      expect(() => allocateByNetRealizableValue(products, 50000)).toThrow(ProcessValidationError);
    });

    it('lanza ProcessValidationError sin productos, con unidades ≤ 0 o costo conjunto negativo', () => {
      expect(() => allocateByPhysicalUnits([], 570000)).toThrow(ProcessValidationError);
      expect(() => allocateByPhysicalUnits([{ productName: 'A', unitsObtained: 0 }], 570000)).toThrow(ProcessValidationError);
      expect(() => allocateByPhysicalUnits([{ productName: 'A', unitsObtained: 100 }], -1)).toThrow(ProcessValidationError);
    });
  });
});
