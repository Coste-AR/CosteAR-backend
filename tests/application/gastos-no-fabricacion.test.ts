import { describe, expect, it, vi } from 'vitest';
import { enrichCalculationResult } from '@/application/cost-structures/calculation-result-enrichment.js';

/**
 * M2-01 (plan de análisis marginal v2, `CosteAR-admin`).
 *
 * `CostElement.VENTA` existe en el schema hace tiempo pero nunca llegaba a
 * `calcularContribucionMarginal`: el punto de equilibrio del tablero era un
 * equilibrio DE PRODUCCIÓN, no de la empresa — le faltaban los gastos de
 * administración y comercialización enteros.
 *
 * Fixture canónico del plan (`AM-01`): 1.000 producidas, 800 vendidas,
 * pv 500, MP 150.000 VARIABLE, MOD 60.000 FIJO, CIP 90.000 VARIABLE (en este
 * caso simplificado — el semifijo real de AM-01 depende de M1-01, todavía no
 * implementado). El punto de comparación es SOLO el efecto de sumar los
 * gastos de no fabricación, no el desglose fino de CIP.
 */

const output = {
  rawMaterialConsumed: 150000,
  directLaborTotal: 60000,
  indirectCostsApplied: 90000,
  productionCost: 300000,
  costOfGoodsSold: 300000,
  grossMargin: 100000,
  grossMarginPct: 25,
  detail: {
    rawMaterial: { optimalLot: 0, finalStockQty: 0, finalStockValue: 0, materials: [] },
    directLabor: {
      workingDays: 0, paidDays: 0, itcsPercent: 0, iapPercent: 0, hourlyRates: {},
      itcsBreakdown: { certain: 0, uncertainRemunerative: 0, derived: 0, uncertainNonRemunerative: 0 },
      departments: [],
    },
    indirectCosts: { perDepartment: {} },
    unitCost: {
      unitsProduced: 1000, unitProductionCost: 300, unitFinishedGoodsCost: 300,
      unitCostOfGoodsSold: 375, basadoEn: 'producidas' as const,
    },
  },
  raw: {} as never,
};

const input = { sales: { unitPrice: 500, quantity: 800, productionQuantity: 1000 } } as never;

// `enrichCalculationResult` lee los gastos de no fabricación DEL PERÍODO
// resuelto (igual que lee `unidadGestion` de la empresa) — no de un parámetro
// que el llamador tenga que acordarse de pasar. Configurar el mock de
// `costPeriod.findFirst` es, a propósito, la única manera de que este test
// los ejercite: así se prueba lo mismo que ejercitaría un `periodId` real.
function db(gastos: { gastoVariableComercializacionPorUnidad: number; gastoFijoAdministracion: number }) {
  return {
    dataPoint: { findMany: vi.fn().mockResolvedValue([]) },
    costPeriod: { findFirst: vi.fn().mockResolvedValue({ id: 'periodo-1', ...gastos }) },
    company: { findFirst: vi.fn().mockResolvedValue({ unidadGestion: null }) },
    parametroCosteo: {
      findMany: vi.fn().mockResolvedValue([
        { id: 'p-mp', clave: 'comportamiento_materia_prima', comportamientoVolumen: 'VARIABLE', structureId: null, periodId: null, clasificadoPorUserId: null, clasificadoEn: null },
        { id: 'p-mod', clave: 'comportamiento_mano_obra_directa', comportamientoVolumen: 'FIJO', structureId: null, periodId: null, clasificadoPorUserId: null, clasificadoEn: null },
        { id: 'p-cip', clave: 'comportamiento_costos_indirectos', comportamientoVolumen: 'VARIABLE', structureId: null, periodId: null, clasificadoPorUserId: null, clasificadoEn: null },
      ]),
    },
    conceptoCosteo: { findMany: vi.fn().mockResolvedValue([]) },
  };
}

const SIN_GASTOS = { gastoVariableComercializacionPorUnidad: 0, gastoFijoAdministracion: 0 };

async function contribucionDe(gastos: { gastoVariableComercializacionPorUnidad: number; gastoFijoAdministracion: number } = SIN_GASTOS) {
  const result = await enrichCalculationResult(db(gastos) as never, {
    structureId: 'estructura-1', companyId: 'empresa-1', periodId: 'periodo-1', input, output: output as never,
  });
  const cm = result.results.contribucionMarginal;
  if (cm.incompleta) throw new Error(`no debería estar incompleta: ${cm.motivos.join(' | ')}`);
  return cm;
}

describe('los gastos de no fabricación entran a la contribución marginal (M2-01)', () => {
  it('SIN gastos de no fabricación: cv = 240, cm = 260 (caso base de este fixture)', async () => {
    const cm = await contribucionDe(undefined);
    // MP 150.000 + CIP 90.000 (los dos VARIABLE, elemento producción) = 240.000
    // ÷ 1.000 PRODUCIDAS = 240 (M0-02: no ÷ 800 vendidas — ese era el bug #88
    // reaparecido en esta capa, que M0-02 corrigió).
    expect(cm.costoVariableUnitarioProduccion).toBe(240);
    expect(cm.costoVariableUnitario).toBe(240);
    expect(cm.contribucionMarginalUnitaria).toBe(260);
    // MOD 60.000 es el único FIJO — sin gastos de administración todavía.
    const fijoTotal = cm.componentes.filter((c) => c.comportamientoVolumen === 'FIJO').reduce((s, c) => s + c.importeAbsorcion, 0);
    expect(fijoTotal).toBe(60000);
  });

  it('CON gastos de no fabricación: el costo variable y los fijos SUBEN, y el PE cambia', async () => {
    const cm = await contribucionDe({ gastoVariableComercializacionPorUnidad: 30, gastoFijoAdministracion: 56000 });
    // cv_producción sigue en 240 (M0-02: no lo toca la comercialización).
    // cv_comercialización = 24.000 / 800 VENDIDAS = 30. cv = 240 + 30 = 270.
    expect(cm.costoVariableUnitarioProduccion).toBe(240);
    expect(cm.costoVariableUnitarioComercializacion).toBe(30);
    expect(cm.costoVariableUnitario).toBe(270);
    expect(cm.contribucionMarginalUnitaria).toBe(230);
    // MOD 60.000 + administración 56.000 = 116.000 de fijos
    const fijoTotal = cm.componentes.filter((c) => c.comportamientoVolumen === 'FIJO').reduce((s, c) => s + c.importeAbsorcion, 0);
    expect(fijoTotal).toBe(116000);

    // Trazabilidad: los dos componentes nuevos aparecen, forzados, sin fila real.
    const comercializacion = cm.componentes.find((c) => c.etiqueta === 'Gastos de comercialización');
    expect(comercializacion).toMatchObject({ comportamientoVolumen: 'VARIABLE', origen: null, importeAbsorcion: 24000 });
    const administracion = cm.componentes.find((c) => c.etiqueta === 'Gastos de administración');
    expect(administracion).toMatchObject({ comportamientoVolumen: 'FIJO', origen: null, importeAbsorcion: 56000 });
  });

  it('el punto de equilibrio de producción y el de la empresa son distintos — la diferencia es la que el tablero le escondía al dueño', async () => {
    const sinVenta = await contribucionDe(undefined);
    const conVenta = await contribucionDe({ gastoVariableComercializacionPorUnidad: 30, gastoFijoAdministracion: 56000 });

    const fijoTotalSinVenta = sinVenta.componentes.filter((c) => c.comportamientoVolumen === 'FIJO').reduce((s, c) => s + c.importeAbsorcion, 0);
    const fijoTotalConVenta = conVenta.componentes.filter((c) => c.comportamientoVolumen === 'FIJO').reduce((s, c) => s + c.importeAbsorcion, 0);
    const peSinVenta = fijoTotalSinVenta / sinVenta.contribucionMarginalUnitaria; // PE de producción
    const peConVenta = fijoTotalConVenta / conVenta.contribucionMarginalUnitaria; // PE de la empresa

    // 60.000/260 = 230,77 vs. 116.000/230 = 504,35 — el PE "de producción" que
    // el tablero mostraba hasta ahora subestima más del doble de lo que la
    // empresa realmente necesita vender para no perder plata.
    expect(peSinVenta).toBeCloseTo(230.77, 1);
    expect(peConVenta).toBeGreaterThan(peSinVenta);
    expect(peConVenta).toBeCloseTo(504.35, 1);
  });

  it('sin gastos de no fabricación (undefined), el comportamiento es exactamente el de antes de M2-01', async () => {
    const resultAntes = await contribucionDe(undefined);
    // Ningún componente de venta aparece cuando no se pasan valores explícitos
    // distinto de cero — pero SÍ aparecen en cero (transparencia): no se
    // esconden, solo no afectan ningún número.
    const comercializacion = resultAntes.componentes.find((c) => c.etiqueta === 'Gastos de comercialización');
    expect(comercializacion?.importeAbsorcion).toBe(0);
  });
});
