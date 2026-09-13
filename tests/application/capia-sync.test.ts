import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CapiaIndicator } from '@/infrastructure/external-apis/capia.js';

const ITEM: CapiaIndicator = {
  indicatorCode: 'CAPIA_HUEVO_BLANCO_CAJON',
  value: 45461.54,
  unit: 'cajon',
  ivaPct: 21,
  priceIncludesIva: true,
  effectiveFrom: new Date('2026-09-07T00:00:00.000Z'),
  effectiveTo: new Date('2026-09-13T00:00:00.000Z'),
  source: 'CAPIA',
  sourceLabel: 'ENCUESTA SEMANAL 36/2026',
  productId: 251,
  product: 'Huevo blanco grande puesto en granja (x cajón)',
  category: 'PRECIO DE VENTA DE PRODUCTOS AVICOLAS',
};

beforeEach(() => vi.clearAllMocks());

describe('syncCapiaPrices', () => {
  it('si CAPIA está ausente no crea filas y deja el motivo en el log', async () => {
    const record = vi.fn();
    const warn = vi.fn();
    const { syncCapiaPrices } = await import('@/application/macro/capia-sync.js');

    const result = await syncCapiaPrices(
      { record } as never,
      { fetchCurrentPrices: vi.fn().mockResolvedValue(null) } as never,
      warn,
    );

    expect(result).toEqual({ stored: 0, reason: 'capia-unavailable' });
    expect(record).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no se persisten'));
  });

  it('dos corridas de la misma semana convergen a una fila por indicador', async () => {
    const rows = new Map<string, unknown>();
    const record = vi.fn(async (input: { source: string; indicatorCode: string; effectiveDate: Date }) => {
      rows.set(`${input.source}:${input.indicatorCode}:${input.effectiveDate.toISOString()}`, input);
      return input;
    });
    const client = { fetchCurrentPrices: vi.fn().mockResolvedValue([ITEM, { ...ITEM, indicatorCode: 'CAPIA_SOJA_TON', productId: 273 }]) };
    const { syncCapiaPrices } = await import('@/application/macro/capia-sync.js');

    await syncCapiaPrices({ record } as never, client as never);
    await syncCapiaPrices({ record } as never, client as never);

    expect(record).toHaveBeenCalledTimes(4);
    expect(rows).toHaveLength(2);
    expect([...rows.values()][0]).toMatchObject({
      source: 'CAPIA',
      effectiveDate: ITEM.effectiveFrom,
      metadata: { unit: 'cajon', ivaPct: 21, priceIncludesIva: true },
    });
  });
});
