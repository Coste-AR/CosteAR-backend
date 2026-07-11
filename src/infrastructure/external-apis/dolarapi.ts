import { getEnv } from '../config/env.js';

/**
 * Adaptador de dolarapi.com — API pública, sin API key — para el dólar BLUE,
 * que el BCRA no publica (es mercado paralelo). Alimenta la vitrina de la
 * landing con el valor en vivo.
 *
 * Doc: https://dolarapi.com  (GET /v1/dolares/blue)
 */
export interface DolarApiIndicator {
  indicatorCode: string;
  value: number;
  effectiveDate: Date;
}

export class DolarApiClient {
  private readonly baseUrl: string;

  constructor(baseUrl = getEnv().DOLARAPI_URL) {
    this.baseUrl = baseUrl;
  }

  /**
   * Cotización del dólar blue (precio de venta, $/USD).
   * Devuelve el último valor publicado, o null si la API falla.
   */
  async fetchBlue(): Promise<DolarApiIndicator | null> {
    try {
      const res = await fetch(`${this.baseUrl}/v1/dolares/blue`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return null;
      const json = (await res.json()) as { venta?: number; fechaActualizacion?: string };
      if (typeof json.venta !== 'number') return null;
      return {
        indicatorCode: 'USD_BLUE',
        value: json.venta,
        effectiveDate: json.fechaActualizacion ? new Date(json.fechaActualizacion) : new Date(),
      };
    } catch {
      // Falla de red / timeout: el worker deja el último valor conocido.
      return null;
    }
  }
}
