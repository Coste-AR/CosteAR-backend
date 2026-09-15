import { describe, expect, it, vi } from 'vitest';
import { enrichCalculationResult } from '@/application/cost-structures/calculation-result-enrichment.js';
import { CLAVES_COMPORTAMIENTO_CONTRIBUCION } from '@/domain/calculations/contribucion-marginal.js';

/**
 * M0-01 (plan de análisis marginal v2, `CosteAR-admin`).
 *
 * `enrichCalculationResult` pasaba exactamente tres importes al costeo
 * variable: MP, MOD y CIP aplicado — el costo NORMAL (renglón 7). Quedaban
 * afuera la variación presupuesto, los trabajos de terceros, la amortización
 * de activos y el desperdicio, que son los renglones 7a-7e del costo REAL.
 *
 * Ahora pasan los siete, y el control de suma verifica contra
 * `netProductionCost` (renglón 7f, expuesto desde #363) — no contra
 * `unitFinishedGoodsCost`, que además arrastra el puente por producción en
 * proceso (fuera de este alcance, ver bitácora de M0-01a).
 */

const output = {
  rawMaterialConsumed: 150000,
  directLaborTotal: 60000,
  indirectCostsApplied: 90000,
  productionCost: 300000, // 150.000 + 60.000 + 90.000
  thirdPartyWork: 10000,
  assetDepreciation: 40000,
  budgetVariance: 0,
  realProductionCost: 350000, // 300.000 + 10.000 + 40.000 + 0
  netProductionCost: 350000, // sin desperdicio en este caso, coincide con el real
  desperdicio: { alCosto: 0, alResultado: 0, recuperoAplicado: 0, pendientes: [] },
  costOfGoodsSold: 350000,
  grossMargin: 150000,
  grossMarginPct: 30,
  detail: {
    rawMaterial: { optimalLot: 0, finalStockQty: 0, finalStockValue: 0, materials: [] },
    directLabor: {
      workingDays: 0, paidDays: 0, itcsPercent: 0, iapPercent: 0, hourlyRates: {},
      itcsBreakdown: { certain: 0, uncertainRemunerative: 0, derived: 0, uncertainNonRemunerative: 0 },
      departments: [],
    },
    indirectCosts: { perDepartment: {} },
    unitCost: {
      unitsProduced: 1000, unitProductionCost: 300, unitFinishedGoodsCost: 350,
      unitCostOfGoodsSold: 437.5, basadoEn: 'producidas' as const,
    },
  },
  raw: {} as never,
};

const input = { sales: { unitPrice: 500, quantity: 800, productionQuantity: 1000 } } as never;

function db(clasificaciones: Array<{ clave: string; comportamientoVolumen: string }> = []) {
  return {
    dataPoint: { findMany: vi.fn().mockResolvedValue([]) },
    costPeriod: { findFirst: vi.fn().mockResolvedValue({ id: 'periodo-1' }) },
    company: { findFirst: vi.fn().mockResolvedValue({ unidadGestion: null }) },
    parametroCosteo: {
      findMany: vi.fn().mockResolvedValue(
        clasificaciones.map((c, i) => ({
          id: `p-${i}`, clave: c.clave, comportamientoVolumen: c.comportamientoVolumen,
          structureId: null, periodId: null, clasificadoPorUserId: null, clasificadoEn: null,
        })),
      ),
    },
  };
}

const TODAS_CLASIFICADAS = [
  { clave: CLAVES_COMPORTAMIENTO_CONTRIBUCION.materiaPrima, comportamientoVolumen: 'VARIABLE' },
  { clave: CLAVES_COMPORTAMIENTO_CONTRIBUCION.manoObraDirecta, comportamientoVolumen: 'FIJO' },
  { clave: CLAVES_COMPORTAMIENTO_CONTRIBUCION.costosIndirectos, comportamientoVolumen: 'VARIABLE' },
  { clave: CLAVES_COMPORTAMIENTO_CONTRIBUCION.variacionPresupuesto, comportamientoVolumen: 'FIJO' },
  { clave: CLAVES_COMPORTAMIENTO_CONTRIBUCION.trabajosDeTerceros, comportamientoVolumen: 'VARIABLE' },
  { clave: CLAVES_COMPORTAMIENTO_CONTRIBUCION.amortizacionActivos, comportamientoVolumen: 'FIJO' },
  { clave: CLAVES_COMPORTAMIENTO_CONTRIBUCION.desperdicioAlCosto, comportamientoVolumen: 'VARIABLE' },
];

describe('el costeo variable pasa a usar el costo REAL neto (M0-01)', () => {
  it('los siete componentes suman exactamente netProductionCost', async () => {
    const result = await enrichCalculationResult(db(TODAS_CLASIFICADAS) as never, {
      structureId: 'estructura-1', companyId: 'empresa-1', input, output: output as never,
    });

    expect(result.results.contribucionMarginal.incompleta).toBe(false);
    if (result.results.contribucionMarginal.incompleta) return;
    // 150.000 + 60.000 + 90.000 + 10.000 + 40.000 (sin variación, sin desperdicio)
    expect(result.results.contribucionMarginal.totalAbsorcion).toBe(350000);
  });

  it('la amortización entra clasificada como FIJO: no infla el costo variable', async () => {
    const result = await enrichCalculationResult(db(TODAS_CLASIFICADAS) as never, {
      structureId: 'estructura-1', companyId: 'empresa-1', input, output: output as never,
    });

    if (result.results.contribucionMarginal.incompleta) throw new Error('no debería estar incompleta');
    // Variable: MP 150.000 + CIP 90.000 + terceros 10.000 = 250.000 (no la amortización)
    expect(result.results.contribucionMarginal.costoVariableTotal).toBe(250000);
  });

  it('sin la amortización clasificada, la contribución sale incompleta (no la asume ni fija ni variable)', async () => {
    const sinAmortizacion = TODAS_CLASIFICADAS.filter(
      (c) => c.clave !== CLAVES_COMPORTAMIENTO_CONTRIBUCION.amortizacionActivos,
    );
    const result = await enrichCalculationResult(db(sinAmortizacion) as never, {
      structureId: 'estructura-1', companyId: 'empresa-1', input, output: output as never,
    });

    expect(result.results.contribucionMarginal.incompleta).toBe(true);
    if (!result.results.contribucionMarginal.incompleta) return;
    expect(result.results.contribucionMarginal.motivos.join(' ')).toMatch(/amortiz/i);
  });

  it('control de suma: si un componente no llega, el faltante se nombra en pesos', async () => {
    // Mismo output, pero netProductionCost "adelantado" (simula que el motor
    // ya sumó un renglón que enrichCalculationResult todavía no reconstruye).
    const conDesfase = { ...output, netProductionCost: 400000 };
    const result = await enrichCalculationResult(db(TODAS_CLASIFICADAS) as never, {
      structureId: 'estructura-1', companyId: 'empresa-1', input, output: conDesfase as never,
    });

    expect(result.results.contribucionMarginal.incompleta).toBe(true);
    if (!result.results.contribucionMarginal.incompleta) return;
    expect(result.results.contribucionMarginal.motivos.join(' ')).toMatch(/50.000|50000/);
  });

  it('sin desperdicio, thirdPartyWork ni assetDepreciation (corrida vieja), no se computan como cero', async () => {
    const vieja = {
      ...output,
      thirdPartyWork: undefined,
      assetDepreciation: undefined,
      budgetVariance: undefined,
      desperdicio: undefined,
      netProductionCost: undefined,
    };
    const result = await enrichCalculationResult(db(TODAS_CLASIFICADAS) as never, {
      structureId: 'estructura-1', companyId: 'empresa-1', input, output: vieja as never,
    });

    // El control de suma no se aplica (no hay netProductionCost), pero la
    // ausencia queda registrada — no desaparece en silencio.
    expect(result.incompletitud.incompleto).toBe(true);
    expect(result.incompletitud.motivos.join(' ')).toMatch(/amortización de activos/i);
    // Lo que sí llegó (MP/MOD/CIP) sigue sumando como siempre.
    expect(result.results.contribucionMarginal.totalAbsorcion).toBe(300000);
  });
});
