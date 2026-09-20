import { describe, expect, it } from 'vitest';
import { Decimal } from 'decimal.js';
import {
  calcularPPPEnMonedaHomogenea,
  prepararMateriaPrimaHomogenea,
  reexpresar,
  tasaReal,
} from '@/domain/calculations/moneda-homogenea.js';

describe('AM-10 — moneda homogénea y tasa real (R33/R34/R35)', () => {
  it('calcula la tasa real por cociente, nunca por resta', () => {
    expect(tasaReal('0.08', '0.05').toDecimalPlaces(6).toNumber()).toBe(0.028571);
    // (1,08 / 1,05)^12 = 1,4022. El 1,4034 escrito en el issue no se
    // reproduce con R33; prevalece la fórmula doctrinaria exacta.
    expect(new Decimal(1).plus(tasaReal('0.08', '0.05')).pow(12).toDecimalPlaces(4).toNumber())
      .toBe(1.4022);
  });

  it('reexpresa cada lote antes de calcular el PPP', () => {
    expect(reexpresar(100, 100, 150).toNumber()).toBe(150);

    const resultado = calcularPPPEnMonedaHomogenea({
      initialStock: { quantity: 0, unitCost: 0, periodCode: '2026-01' },
      movements: [
        { date: '2026-01-10', periodCode: '2026-01', type: 'purchase', detail: 'Lote 1', quantity: 1000, unitCost: 100 },
        { date: '2026-07-10', periodCode: '2026-07', type: 'purchase', detail: 'Lote 2', quantity: 1000, unitCost: 150 },
        { date: '2026-07-15', periodCode: '2026-07', type: 'consumption', detail: 'Consumo', quantity: 2000 },
      ],
      indices: { '2026-01': 100, '2026-07': 150 },
      destinationPeriodCode: '2026-07',
      seriesVersionId: '11111111-1111-1111-1111-111111111111',
    });

    expect(resultado.ledger.rawMaterialConsumed.toNumber()).toBe(300000);
    expect(resultado.ledger.rows.at(-1)?.movementUnitCost.toNumber()).toBe(150);
    expect(resultado.currency).toMatchObject({
      kind: 'HOMOGENEA',
      periodCode: '2026-07',
      index: 150,
      missingPeriodCodes: [],
    });
  });

  it('si falta un índice conserva exactamente el PPP nominal y declara la ausencia', () => {
    const resultado = calcularPPPEnMonedaHomogenea({
      initialStock: { quantity: 0, unitCost: 0, periodCode: '2026-01' },
      movements: [
        { date: '2026-01-10', periodCode: '2026-01', type: 'purchase', detail: 'Lote 1', quantity: 1000, unitCost: 100 },
        { date: '2026-07-10', periodCode: '2026-07', type: 'purchase', detail: 'Lote 2', quantity: 1000, unitCost: 150 },
        { date: '2026-07-15', periodCode: '2026-07', type: 'consumption', detail: 'Consumo', quantity: 2000 },
      ],
      indices: { '2026-07': 150 },
      destinationPeriodCode: '2026-07',
      seriesVersionId: '11111111-1111-1111-1111-111111111111',
    });

    expect(resultado.ledger.rawMaterialConsumed.toNumber()).toBe(250000);
    expect(resultado.currency).toEqual({
      kind: 'NOMINAL',
      periodCode: null,
      index: null,
      seriesVersionId: null,
      missingPeriodCodes: ['2026-01'],
    });
  });

  it('la capa previa al motor transforma precios declarados y no toca cantidades', () => {
    const input = {
      materials: [{
        name: 'Insumo ficticio', unit: 'kg',
        wilson: { annualDemand: 1, orderCost: 1, holdingRate: 1, unitCost: 1 },
        stockPolicy: { minConsumption: 0, maxConsumption: 0, minLeadTime: 0, maxLeadTime: 0, safetyStock: 0 },
        initialStock: { quantity: 0, unitCost: 0 },
        movements: [{
          date: '2026-01-10', periodCode: '2026-01', type: 'purchase' as const,
          detail: 'Compra', quantity: 1000, unitCost: 100,
        }],
      }],
    };
    const prepared = prepararMateriaPrimaHomogenea(input, {
      destinationPeriodCode: '2026-07', seriesVersionId: 'v1',
      indices: { '2026-01': 100, '2026-07': 150 },
    });

    expect(prepared.rawMaterial.materials[0]!.movements[0]).toMatchObject({ quantity: 1000, unitCost: 150 });
    expect(prepared.currency.kind).toBe('HOMOGENEA');
  });

  it('una compra sin período no se infiere de la fecha: toda la ficha queda nominal', () => {
    const input = {
      materials: [{
        name: 'Insumo ficticio', unit: 'kg',
        wilson: { annualDemand: 1, orderCost: 1, holdingRate: 1, unitCost: 1 },
        stockPolicy: { minConsumption: 0, maxConsumption: 0, minLeadTime: 0, maxLeadTime: 0, safetyStock: 0 },
        initialStock: { quantity: 0, unitCost: 0 },
        movements: [{ date: '2026-01-10', type: 'purchase' as const, detail: 'Compra', quantity: 1000, unitCost: 100 }],
      }],
    };
    const prepared = prepararMateriaPrimaHomogenea(input, {
      destinationPeriodCode: '2026-07', seriesVersionId: 'v1', indices: { '2026-07': 150 },
    });

    expect(prepared.rawMaterial).toBe(input);
    expect(prepared.currency).toMatchObject({ kind: 'NOMINAL', missingPeriodCodes: ['compra-sin-periodo'] });
  });
});
