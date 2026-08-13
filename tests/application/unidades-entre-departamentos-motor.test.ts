import { describe, it, expect } from 'vitest';
import {
  ProcessCostingEngine,
  type ProcessCalculationInput,
  type ProcessDepartmentInput,
} from '@/application/cost-structures/process-costing/process-costing-engine.js';

/**
 * H12 — EL FACTOR CAMBIA LAS UNIDADES, NUNCA EL TOTAL EN PESOS.
 *
 * `unidades-entre-departamentos.test.ts` cubre la VALIDACIÓN del factor (que las
 * recibidas cuadren con las transferidas × factor). Esto de acá cubre la otra
 * mitad, la que faltaba: que el MOTOR aplique el factor cuando la plata cruza de
 * un departamento al siguiente.
 *
 * La propiedad que se blinda es una sola: convertir la unidad de medida reparte
 * el mismo dinero en más (o menos) pedacitos — el costo TOTAL que sale de una
 * etapa es idéntico al que entra a la que sigue. Si el factor se aplicara al
 * dinero, el costo del producto terminado saldría multiplicado por el factor.
 *
 * Caso: citrícola. Departamento 1 mide en TONELADAS de fruta, el 2 en LITROS de
 * jugo, con factor 500 litros por tonelada.
 */

const PERIOD = 'per-julio';

/** Extracción (seq 1) · 8.500 toneladas por $425.000.000 = $50.000 la tonelada. */
const extraccion: ProcessDepartmentInput = {
  id: 'dept-extraccion',
  name: 'Extracción',
  sequence: 1,
  conversionUnified: true,
  periodId: PERIOD,
  units: {
    startedInProduction: 8500,
    transferredOut: 8500,
    finishedInStock: 0,
    // finalWip derivada = 0
  },
  costs: {
    mpPeriodo: 340000000,
    moPeriodo: 85000000, // MP 40.000 + CC 10.000 = $50.000 la tonelada
  },
};

describe('H12 · motor — el factor de conversión no multiplica la plata', () => {
  const engine = new ProcessCostingEngine();

  it('sin existencia inicial: $50.000 la tonelada entran como $100 el litro y el total se conserva', () => {
    /** Concentración (seq 2) · recibe 8.500 t × 500 = 4.250.000 litros. */
    const concentracion: ProcessDepartmentInput = {
      id: 'dept-concentracion',
      name: 'Concentración',
      sequence: 2,
      conversionUnified: true,
      periodId: PERIOD,
      conversionFromPrevious: 500,
      units: {
        receivedFromPrevious: 4250000,
        transferredOut: 4250000,
        finishedInStock: 0,
      },
      costs: {},
    };

    const input: ProcessCalculationInput = { departments: [extraccion, concentracion] };
    const { results } = engine.run(input);

    const d1 = results.departments.find((d) => d.name === 'Extracción')!;
    const d2 = results.departments.find((d) => d.name === 'Concentración')!;

    // El unitario cruza CONVERTIDO: $50.000/tonelada ÷ 500 = $100/litro.
    expect(d2.transferredCost!.costoTransferido).toBe(100);
    // Y el total es EL MISMO a los dos lados de la frontera.
    expect(d1.report.costoTerminadasYTransferidas).toBe(425000000);
    expect(d2.report.previousDepartment!.costoTotal).toBe(425000000);
  });

  it('con existencia inicial: el costo modificado promedia en la unidad del que recibe', () => {
    /**
     * Concentración con EI de 250.000 litros que ya traía $2.500.000 del anterior
     * ($10 el litro del mes pasado). Costo modificado = ($2.500.000 + $425.000.000)
     * ÷ (250.000 + 4.250.000) = $427.500.000 ÷ 4.500.000 = $95 el litro.
     */
    const concentracion: ProcessDepartmentInput = {
      id: 'dept-concentracion',
      name: 'Concentración',
      sequence: 2,
      conversionUnified: true,
      periodId: PERIOD,
      conversionFromPrevious: 500,
      units: {
        initialWip: 250000,
        receivedFromPrevious: 4250000,
        transferredOut: 4500000,
        finishedInStock: 0,
      },
      costs: {},
      initialWipTransferredCost: 2500000,
    };

    const input: ProcessCalculationInput = { departments: [extraccion, concentracion] };
    const { results } = engine.run(input);
    const d2 = results.departments.find((d) => d.name === 'Concentración')!;

    expect(d2.transferredCost!.costoModificado).toBe(95);
    // Conservación otra vez: lo que traía la EI + lo que entró en el mes.
    expect(d2.report.previousDepartment!.costoTotal).toBe(427500000);
  });

  it('sin factor declarado el motor se comporta igual que siempre (factor 1)', () => {
    const siguiente: ProcessDepartmentInput = {
      id: 'dept-siguiente',
      name: 'Siguiente',
      sequence: 2,
      conversionUnified: true,
      periodId: PERIOD,
      units: {
        receivedFromPrevious: 8500,
        transferredOut: 8500,
        finishedInStock: 0,
      },
      costs: {},
    };

    const { results } = engine.run({ departments: [extraccion, siguiente] });
    const d2 = results.departments.find((d) => d.name === 'Siguiente')!;

    expect(d2.transferredCost!.costoTransferido).toBe(50000);
    expect(d2.report.previousDepartment!.costoTotal).toBe(425000000);
  });
});
