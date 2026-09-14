import { getEnv } from '../config/env.js';

export type CapiaUnit = 'cajon' | 'kg' | 'ton' | 'unidad' | 'ave';

export interface CapiaIndicator {
  indicatorCode: string;
  value: number;
  unit: CapiaUnit | null;
  ivaPct: number;
  priceIncludesIva: true;
  effectiveFrom: Date;
  effectiveTo: Date;
  source: 'CAPIA';
  sourceLabel: string;
  productId: number;
  product: string;
  category: string;
}

const INDICATOR_CODES: Readonly<Record<number, string>> = {
  251: 'CAPIA_HUEVO_BLANCO_CAJON',
  252: 'CAPIA_HUEVO_COLOR_CAJON',
  253: 'CAPIA_POLLO_PARRILLERO_KG',
  254: 'CAPIA_HUEVO_FRESCO_KG',
  255: 'CAPIA_POLLITA_BB_COLOR_UNIDAD',
  262: 'CAPIA_POLLA_14_SEMANAS_COLOR_UNIDAD',
  263: 'CAPIA_POLLA_14_SEMANAS_BLANCA_UNIDAD',
  264: 'CAPIA_POLLA_16_SEMANAS_COLOR_UNIDAD',
  265: 'CAPIA_POLLA_16_SEMANAS_BLANCA_UNIDAD',
  266: 'CAPIA_POLLA_18_SEMANAS_COLOR_UNIDAD',
  267: 'CAPIA_POLLA_18_SEMANAS_BLANCA_UNIDAD',
  268: 'CAPIA_ALIMENTO_PONEDORA_KG',
  269: 'CAPIA_ALIMENTO_PARRILLERO_KG',
  270: 'CAPIA_MAPLE_UNIDAD',
  271: 'CAPIA_ESTUCHE_UNIDAD',
  272: 'CAPIA_MAIZ_TON',
  273: 'CAPIA_SOJA_TON',
  275: 'CAPIA_POLLITA_BB_BLANCA_UNIDAD',
  276: 'CAPIA_POLLITO_BB_PARRILLERO_UNIDAD',
  277: 'CAPIA_GALLINA_BLANCA_AVE',
  278: 'CAPIA_GALLINA_COLOR_AVE',
};

const UNIT_CODES: Readonly<Record<string, CapiaUnit>> = {
  'x cajón': 'cajon',
  kg: 'kg',
  ton: 'ton',
  'c/u': 'unidad',
  ave: 'ave',
};

interface CapiaResponse {
  ok?: unknown;
  semana?: { titulo?: unknown; fecha_inicio?: unknown; fecha_fin?: unknown };
  items?: unknown[];
}

interface RawCapiaItem {
  category: string;
  product: string;
  product_id: number;
  price_final: number;
  iva_pct: number;
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (!match) return null;
  const [, dayText, monthText, yearText] = match;
  const day = Number(dayText);
  const month = Number(monthText);
  const year = Number(yearText);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day
    ? parsed
    : null;
}

function parseItem(value: unknown): RawCapiaItem | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Partial<RawCapiaItem>;
  if (
    typeof item.category !== 'string'
    || typeof item.product !== 'string'
    || typeof item.product_id !== 'number'
    || !Number.isInteger(item.product_id)
    || typeof item.price_final !== 'number'
    || !Number.isFinite(item.price_final)
    || typeof item.iva_pct !== 'number'
    || !Number.isFinite(item.iva_pct)
  ) return null;
  return item as RawCapiaItem;
}

function parseUnit(product: string): CapiaUnit | null {
  const match = /\(([^()]*)\)\s*$/.exec(product);
  return match?.[1] ? (UNIT_CODES[match[1].trim().toLocaleLowerCase('es-AR')] ?? null) : null;
}

/** Adaptador tolerante a fallas de la API abierta que usa la web de CAPIA. */
export class CapiaClient {
  constructor(private readonly baseUrl = getEnv().CAPIA_API_URL) {}

  async fetchCurrentPrices(): Promise<CapiaIndicator[] | null> {
    try {
      const response = await fetch(`${this.baseUrl}/api/precios_vigentes`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) return null;

      const json = (await response.json()) as CapiaResponse;
      const effectiveFrom = parseDate(json.semana?.fecha_inicio);
      const effectiveTo = parseDate(json.semana?.fecha_fin);
      const sourceLabel = json.semana?.titulo;
      if (
        json.ok !== true
        || typeof sourceLabel !== 'string'
        || !effectiveFrom
        || !effectiveTo
        || !Array.isArray(json.items)
        || json.items.length === 0
      ) return null;

      const parsedItems = json.items.map(parseItem);
      if (parsedItems.some((item) => item === null)) return null;

      return (parsedItems as RawCapiaItem[]).map((item) => {
        const unit = parseUnit(item.product);
        if (!unit) {
          console.warn('[capia] Unidad no reconocida; se conserva como null', {
            productId: item.product_id,
            product: item.product,
          });
        }
        return {
          indicatorCode: INDICATOR_CODES[item.product_id] ?? `CAPIA_${item.product_id}`,
          value: item.price_final,
          unit,
          ivaPct: item.iva_pct,
          priceIncludesIva: true,
          effectiveFrom,
          effectiveTo,
          source: 'CAPIA',
          sourceLabel,
          productId: item.product_id,
          product: item.product,
          category: item.category,
        };
      });
    } catch {
      return null;
    }
  }
}
