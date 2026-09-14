import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';

const fixturePath = new URL('../fixtures/capia-precios-vigentes.json', import.meta.url);
const fixture = JSON.parse(await readFile(fixturePath, 'utf8')) as Record<string, unknown>;

afterEach(() => vi.restoreAllMocks());

describe('CapiaClient', () => {
  it('adapta los 21 precios reales con códigos, unidades y rango semanal', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(fixture))));
    const { CapiaClient } = await import('@/infrastructure/external-apis/capia.js');

    const result = await new CapiaClient('https://capia.example').fetchCurrentPrices();

    expect(result).toHaveLength(21);
    expect(result?.[0]).toMatchObject({
      indicatorCode: 'CAPIA_HUEVO_BLANCO_CAJON',
      value: 45461.54,
      unit: 'cajon',
      ivaPct: 21,
      priceIncludesIva: true,
      effectiveFrom: new Date('2026-09-07T00:00:00.000Z'),
      effectiveTo: new Date('2026-09-13T00:00:00.000Z'),
      source: 'CAPIA',
      sourceLabel: 'ENCUESTA SEMANAL 36/2026',
    });
    expect(result?.find((item) => item.indicatorCode === 'CAPIA_ALIMENTO_PONEDORA_KG')?.unit).toBe('kg');
    expect(result?.find((item) => item.indicatorCode === 'CAPIA_MAIZ_TON')?.unit).toBe('ton');
    expect(result?.find((item) => item.indicatorCode === 'CAPIA_MAPLE_UNIDAD')?.unit).toBe('unidad');
    expect(result?.find((item) => item.indicatorCode === 'CAPIA_GALLINA_BLANCA_AVE')?.unit).toBe('ave');
  });

  it('devuelve null cuando CAPIA declara que la encuesta no está disponible', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"ok":false}')));
    const { CapiaClient } = await import('@/infrastructure/external-apis/capia.js');
    expect(await new CapiaClient('https://capia.example').fetchCurrentPrices()).toBeNull();
  });

  it('conserva un producto nuevo y deja su unidad en null sin afectar los demás', async () => {
    const changed = structuredClone(fixture) as { items: Array<Record<string, unknown>> };
    changed.items.push({ category: 'NUEVOS', product: 'Producto sin unidad', product_id: 999, price_final: 10, iva_pct: 21 });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(changed))));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { CapiaClient } = await import('@/infrastructure/external-apis/capia.js');

    const result = await new CapiaClient('https://capia.example').fetchCurrentPrices();

    expect(result).toHaveLength(22);
    expect(result?.at(-1)).toMatchObject({ indicatorCode: 'CAPIA_999', product: 'Producto sin unidad', unit: null });
    expect(result?.[0]?.unit).toBe('cajon');
    expect(warn).toHaveBeenCalledOnce();
  });

  it('devuelve null ante timeout o error de red', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('timeout', 'TimeoutError')));
    const { CapiaClient } = await import('@/infrastructure/external-apis/capia.js');
    expect(await new CapiaClient('https://capia.example').fetchCurrentPrices()).toBeNull();
  });
});
