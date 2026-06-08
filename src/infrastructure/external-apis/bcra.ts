import { getEnv } from '../config/env.js';

/**
 * Adaptador del Banco Central (BCRA). Usa la API pública de Estadísticas
 * Cambiarias v1. El tipo de cambio mayorista/minorista alimenta el recálculo
 * de costos cuando hay volatilidad.
 *
 * Doc: https://www.bcra.gob.ar/Catalogo/apis.asp
 */
export interface BcraIndicator {
  indicatorCode: string;
  value: number;
  effectiveDate: Date;
}

export class BcraClient {
  private readonly baseUrl: string;

  constructor(baseUrl = getEnv().BCRA_API_URL) {
    this.baseUrl = baseUrl;
  }

  /**
   * Cotización del dólar oficial (variable 1: Tipo de Cambio Minorista, $/USD).
   * Devuelve el último valor publicado.
   */
  async fetchOfficialUsd(): Promise<BcraIndicator | null> {
    try {
      const res = await fetch(`${this.baseUrl}/estadisticascambiarias/v1.0/Cotizaciones/USD`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return null;
      const json = (await res.json()) as {
        results?: Array<{ fecha: string; detalle?: Array<{ tipoCotizacion: number }> }>;
      };
      const latest = json.results?.[0];
      const detail = latest?.detalle?.[0];
      if (!latest || !detail) return null;
      return {
        indicatorCode: 'USD_OFICIAL',
        value: detail.tipoCotizacion,
        effectiveDate: new Date(latest.fecha),
      };
    } catch {
      // Falla de red / timeout: el worker usará el último valor conocido.
      return null;
    }
  }
}
