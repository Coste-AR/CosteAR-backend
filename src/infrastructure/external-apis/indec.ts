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

// Serie IPC Nivel general, nacional, variación mensual.
const IPC_NACIONAL_SERIE = '145.3_INGNACNAL_DICI_M_38';

export class IndecClient {
  private readonly baseUrl: string;

  constructor(baseUrl = getEnv().INDEC_API_URL) {
    this.baseUrl = baseUrl;
  }

  /** Último valor del IPC nacional (índice nivel general). */
  async fetchIpcNacional(): Promise<IndecIndicator | null> {
    try {
      const url = `${this.baseUrl}/series?ids=${IPC_NACIONAL_SERIE}&limit=1&sort=desc&format=json`;
      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return null;
      const json = (await res.json()) as { data?: Array<[string, number]> };
      const point = json.data?.[0];
      if (!point) return null;
      return {
        indicatorCode: 'IPC_NACIONAL',
        value: point[1],
        effectiveDate: new Date(point[0]),
      };
    } catch {
      return null;
    }
  }
}
