import { getEnv } from '../config/env.js';

/**
 * Adaptador de INDEC vía la API de Series de Tiempo de datos.gob.ar.
 * El IPC nacional alimenta los ajustes por inflación.
 *
 * Doc: https://datosgobar.github.io/series-tiempo-ar-api/
 */
export interface IndecIndicator {
  indicatorCode: string;
  value: number;
  effectiveDate: Date;
}

// Serie IPC Nivel General Nacional, base dic 2016.
// :percent_change devuelve variación % vs mes anterior (ej: 0.0338 = 3.38%).
// ID actualizado jun-2026 — el ID anterior (145.3_INGNACNAL_DICI_M_38) fue discontinuado.
const IPC_NACIONAL_SERIE = '148.3_INIVELNAL_DICI_M_26:percent_change';

export class IndecClient {
  private readonly baseUrl: string;

  constructor(baseUrl = getEnv().INDEC_API_URL) {
    this.baseUrl = baseUrl;
  }

  /** Último valor del IPC nacional (índice nivel general). */
  async fetchIpcNacional(): Promise<IndecIndicator | null> {
    try {
      // Trailing slash evita el 301 que la API emite sin él
      const url = `${this.baseUrl}/series/?ids=${IPC_NACIONAL_SERIE}&limit=1&sort=desc&format=json`;
      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return null;
      const json = (await res.json()) as { data?: Array<[string, number]> };
      const point = json.data?.[0];
      if (!point) return null;
      // La API devuelve fracción (0.0338 = 3.38%) → multiplicar por 100
      return {
        indicatorCode: 'IPC_NACIONAL',
        value: Math.round(point[1] * 1000) / 10, // ej: 0.0338 → 3.4
        effectiveDate: new Date(point[0]),
      };
    } catch {
      return null;
    }
  }
}
