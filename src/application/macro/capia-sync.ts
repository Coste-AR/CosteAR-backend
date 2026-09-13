import type { MacroService } from './macro-service.js';
import type { CapiaClient } from '../../infrastructure/external-apis/capia.js';

export interface CapiaSyncResult {
  stored: number;
  reason: 'capia-unavailable' | null;
}

/** Persiste la semana vigente. El upsert de MacroService vuelve idempotente cada corrida. */
export async function syncCapiaPrices(
  macro: Pick<MacroService, 'record'>,
  capia: Pick<CapiaClient, 'fetchCurrentPrices'>,
  warn: (message: string) => void = (message) => console.warn(message),
): Promise<CapiaSyncResult> {
  const items = await capia.fetchCurrentPrices();
  if (!items) {
    warn('[capia] Encuesta vigente ausente o respuesta inválida; no se persisten precios');
    return { stored: 0, reason: 'capia-unavailable' };
  }

  await Promise.all(items.map((item) => macro.record({
    source: 'CAPIA',
    indicatorCode: item.indicatorCode,
    value: item.value,
    effectiveDate: item.effectiveFrom,
    metadata: {
      unit: item.unit,
      ivaPct: item.ivaPct,
      priceIncludesIva: item.priceIncludesIva,
      effectiveTo: item.effectiveTo.toISOString(),
      sourceLabel: item.sourceLabel,
      productId: item.productId,
      product: item.product,
      category: item.category,
    },
  })));

  return { stored: items.length, reason: null };
}
