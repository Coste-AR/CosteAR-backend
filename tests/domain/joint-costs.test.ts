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
  describe('FX-J1 · Ancla M1 · unidades físicas (Clase 24)', () => {
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

  describe('FX-J1 · Ancla M3 · valor de mercado en el punto de separación (Clase 24)', () => {
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

  describe('FX-J1 · Ancla M4 · valor neto de realización VNR (Clase 24)', () => {
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

  describe('FX-J1 · Ancla M2 · factor técnico (Clase 24)', () => {
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

/**
 * FX-P3 · CCEDA SA — costos conjuntos en DOS puntos de separación (Clase 23).
 *
 * Procesamiento industrial de granos de cacao en tres departamentos. Hay dos
 * puntos de separación, y ese es el motivo de que este caso exista: verifica
 * que el método de VNR se aplica dos veces sobre la misma corrida, con listas
 * de productos distintas y costos conjuntos distintos.
 *
 *   Depto. 1 (Tostado)  → pasta de cacao (80 ton) + cáscara (10 ton)
 *   Depto. 2 (Prensado) → manteca (60 ton) + polvo (20 ton)
 *
 * Fuente: cátedra, Clase 23 — "Cálculo de costos en procesos productivos:
 * departamentos uno, dos y tres". Los valores están transcriptos de la clase,
 * no derivados del motor.
 *
 * ── SOBRE EL REDONDEO, QUE NO ES UN DETALLE ─────────────────────────────────
 *
 * La cátedra REDONDEA la participación a 2 decimales y recién después multiplica
 * por el costo conjunto. CosteAR mantiene la fracción completa (`Money`, 28
 * dígitos) y multiplica sin redondear.
 *
 * En el punto de separación del Depto. 1 las dos rutas coinciden al centavo. En
 * el del Depto. 2 NO: dan $12,47 de diferencia sobre $278.587. Ninguna de las
 * dos está mal — es una diferencia de método de presentación, y el test la deja
 * escrita en vez de taparla eligiendo el número que convenga.
 *
 * Lo que se ancla, entonces, es lo que SÍ es doctrina: las participaciones (que
 * coinciden con la clase a 2 decimales) y el control Σ asignados = total.
 */
describe('FX-P3 · CCEDA SA — dos puntos de separación por VNR (Clase 23)', () => {
  describe('Punto de separación del Depto. 1 — costo conjunto $76.500', () => {
    const products: JointProduct[] = [
      // Producción a precio de mercado $160.000, gastos 20 % ⇒ VNR $128.000.
      { productName: 'Pasta de cacao', unitsObtained: 80, marketPrice: 2000, sellingCostVarPct: 0.2 },
      // Producción a precio de mercado $2.000, gastos 5 % ⇒ VNR $1.900.
      { productName: 'Cáscara de cacao', unitsObtained: 10, marketPrice: 200, sellingCostVarPct: 0.05 },
    ];

    it('las bases son los VNR de la clase: $128.000 y $1.900 (total $129.900)', () => {
      const r = allocateByNetRealizableValue(products, 76500);

      expect(r.lines.map((l) => l.allocationBase.toNumber())).toEqual([128000, 1900]);
      expect(round(r.lines[0]!.allocationBase.plus(r.lines[1]!.allocationBase))).toBe(129900);
    });

    it('las participaciones son 98,5373 % y 1,4627 % (la clase las imprime truncadas)', () => {
      const r = allocateByNetRealizableValue(products, 76500);

      // La Clase 23 imprime "98,53 %" y "1,46 %". El valor exacto es 98,5373…,
      // así que 98,53 está TRUNCADO, no redondeado. Se ancla el número real a 4
      // decimales para no fijar el error de transcripción de la clase.
      expect(round(r.lines[0]!.participationPct.times(100), 4)).toBe(98.5373);
      expect(round(r.lines[1]!.participationPct.times(100), 4)).toBe(1.4627);
    });

    it('acá SÍ cierra al centavo con la clase: $942,26/ton y $111,89/ton', () => {
      const r = allocateByNetRealizableValue(products, 76500);

      // Los costos unitarios impresos en la Clase 23.
      expect(round(r.lines[0]!.unitCost)).toBe(942.26);
      expect(round(r.lines[1]!.unitCost)).toBe(111.89);

      // Y los costos atribuidos: la clase imprime $75.381 y $1.119.
      expect(round(r.lines[0]!.allocatedCost, 0)).toBe(75381);
      expect(round(r.lines[1]!.allocatedCost, 0)).toBe(1119);
    });

    it('control: Σ asignados = costo conjunto total', () => {
      const r = allocateByNetRealizableValue(products, 76500);
      expect(round(r.totalAllocated)).toBe(76500);
    });
  });

  describe('Punto de separación del Depto. 2 — costo conjunto $278.587', () => {
    const products: JointProduct[] = [
      // Producción a precio de mercado $300.000, gastos 20 % ⇒ VNR $240.000.
      { productName: 'Manteca de cacao', unitsObtained: 60, marketPrice: 5000, sellingCostVarPct: 0.2 },
      // Producción a precio de mercado $60.000, gastos 15 % ⇒ VNR $51.000.
      { productName: 'Polvo de cacao', unitsObtained: 20, marketPrice: 3000, sellingCostVarPct: 0.15 },
    ];

    it('las bases son los VNR de la clase: $240.000 y $51.000 (total $291.000)', () => {
      const r = allocateByNetRealizableValue(products, 278587);

      expect(r.lines.map((l) => l.allocationBase.toNumber())).toEqual([240000, 51000]);
    });

    it('las participaciones dan 82,47 % y 17,53 %, como en la clase', () => {
      const r = allocateByNetRealizableValue(products, 278587);

      // Esto es lo que hay que anclar: la DOCTRINA coincide exacto.
      expect(round(r.lines[0]!.participationPct.times(100), 2)).toBe(82.47);
      expect(round(r.lines[1]!.participationPct.times(100), 2)).toBe(17.53);
    });

    /**
     * ACÁ SE SEPARAN LOS CAMINOS, y queda documentado a propósito.
     *
     * La clase multiplica la participación YA REDONDEADA:
     *     0,8247 × $278.587 = $229.750   ⇒ $3.829,18/ton
     * El motor multiplica la fracción completa:
     *     (240.000/291.000) × $278.587 = $229.762,47 ⇒ $3.829,37/ton
     *
     * $12,47 sobre $278.587 (0,0045 %). El motor es el que NO pierde precisión;
     * la clase redondea para poder hacerlo a mano. Si algún día se decide
     * replicar el redondeo de la cátedra, este test es el que hay que cambiar —
     * y va a ser una decisión consciente, que es de lo que se trata.
     */
    it('el motor NO redondea la participación antes de multiplicar (difiere $12,47 de la clase)', () => {
      const r = allocateByNetRealizableValue(products, 278587);

      expect(round(r.lines[0]!.allocatedCost)).toBe(229762.47);
      expect(round(r.lines[1]!.allocatedCost)).toBe(48824.53);

      // Lo que imprime la Clase 23, con la participación redondeada a 4 decimales.
      const claseManteca = 229750;
      expect(round(r.lines[0]!.allocatedCost) - claseManteca).toBeCloseTo(12.47, 2);
    });

    it('control: Σ asignados = costo conjunto total, sin fuga por redondeo', () => {
      const r = allocateByNetRealizableValue(products, 278587);
      expect(round(r.totalAllocated)).toBe(278587);
    });
  });
});
