import type { MacroSource, PrismaClient } from '@prisma/client';
import { NotFoundError } from '../../domain/errors/domain-error.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { CATEGORY_BY_INDUSTRY, CATEGORIA_AVICOLA_POSTURA, PAQUETE_AVICOLA_POSTURA } from '../operacion/paquete-avicola.js';
import { PaqueteRubroService } from '../operacion/paquete-rubro-service.js';

interface IndicadorMacroConfigurado {
  clave: string;
  etiqueta: string;
  unidad: string | null;
  fuente: MacroSource;
}

const CORE_INDICATORS: readonly IndicadorMacroConfigurado[] = [
  { clave: 'USD_OFICIAL', etiqueta: 'Dólar oficial', unidad: 'ARS/USD', fuente: 'BCRA' },
  { clave: 'IPC_NACIONAL', etiqueta: 'Inflación mensual', unidad: '%', fuente: 'INDEC' },
];

const SOURCE_DETAILS: Record<MacroSource, { nombre: string; url: string }> = {
  BCRA: {
    nombre: 'Banco Central de la República Argentina',
    url: 'https://api.bcra.gob.ar/estadisticascambiarias/v1.0/Cotizaciones/USD',
  },
  INDEC: {
    nombre: 'INDEC',
    url: 'https://apis.datos.gob.ar/series/api/series/?ids=148.3_INIVELNAL_DICI_M_26:percent_change',
  },
  DOLARAPI: { nombre: 'DolarApi', url: 'https://dolarapi.com/dolar/blue' },
  CAPIA: { nombre: 'CAPIA', url: 'https://capia.com.ar/estadisticas/precio-del-huevo-semanal' },
  ARCA: { nombre: 'ARCA', url: 'https://www.arca.gob.ar/' },
  PARITARIA: { nombre: 'Paritaria', url: 'https://www.argentina.gob.ar/trabajo' },
};

function isConfiguredIndicator(value: unknown): value is IndicadorMacroConfigurado {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<IndicadorMacroConfigurado>;
  return typeof item.clave === 'string'
    && typeof item.etiqueta === 'string'
    && (typeof item.unidad === 'string' || item.unidad === null)
    && typeof item.fuente === 'string'
    && item.fuente in SOURCE_DETAILS;
}

function indicatorsFromScreens(screens: unknown): IndicadorMacroConfigurado[] | null {
  if (!screens || typeof screens !== 'object' || Array.isArray(screens)) return null;
  const configured = (screens as { indicadoresMacro?: unknown }).indicadoresMacro;
  if (!Array.isArray(configured)) return null;
  return configured.filter(isConfiguredIndicator);
}

/**
 * Vista por empresa sobre el caché de snapshots que alimenta el worker macro.
 * No vuelve a consultar proveedores en cada GET: #350 ya definió una única
 * ingesta diaria y append-only para BCRA, INDEC, DolarApi y CAPIA.
 */
export class IndicadoresMacroService {
  constructor(private readonly db: PrismaClient = prisma) {}

  async listar(userId: string, companyId: string) {
    const company = await this.db.company.findFirst({
      where: { id: companyId, userId },
      select: { industry: true },
    });
    if (!company) throw new NotFoundError('Empresa no encontrada');

    const category = company.industry
      ? CATEGORY_BY_INDUSTRY[company.industry as keyof typeof CATEGORY_BY_INDUSTRY]
      : undefined;

    let packageIndicators: IndicadorMacroConfigurado[] = [];
    if (category) {
      const paquete = await new PaqueteRubroService(this.db).resolve(userId, category, { companyId });
      packageIndicators = indicatorsFromScreens(paquete.screens)
        // Compatibilidad con la fila global sembrada antes de #388. El próximo
        // seed la actualiza; hasta entonces el paquete canónico cubre el campo nuevo.
        ?? (category === CATEGORIA_AVICOLA_POSTURA
          ? indicatorsFromScreens(PAQUETE_AVICOLA_POSTURA.screens) ?? []
          : []);
    }

    const configuredByKey = new Map<string, IndicadorMacroConfigurado>();
    for (const indicator of [...CORE_INDICATORS, ...packageIndicators]) {
      configuredByKey.set(`${indicator.fuente}:${indicator.clave}`, indicator);
    }
    const configured = [...configuredByKey.values()];
    const rows = await this.db.macroSnapshot.findMany({
      where: {
        OR: configured.map((indicator) => ({
          source: indicator.fuente,
          indicatorCode: indicator.clave,
        })),
      },
      orderBy: { effectiveDate: 'desc' },
    });

    const latest = new Map<string, typeof rows[number]>();
    for (const row of rows) {
      const key = `${row.source}:${row.indicatorCode}`;
      if (!latest.has(key)) latest.set(key, row);
    }

    return configured.map((indicator) => {
      const row = latest.get(`${indicator.fuente}:${indicator.clave}`);
      const source = SOURCE_DETAILS[indicator.fuente];
      if (!row) {
        return {
          clave: indicator.clave,
          etiqueta: indicator.etiqueta,
          valor: null,
          unidad: indicator.unidad,
          fecha: null,
          fuenteNombre: source.nombre,
          fuenteUrl: source.url,
          error: 'fuente no disponible' as const,
        };
      }
      return {
        clave: indicator.clave,
        etiqueta: indicator.etiqueta,
        valor: Number(row.value),
        unidad: indicator.unidad,
        fecha: row.effectiveDate.toISOString(),
        fuenteNombre: source.nombre,
        fuenteUrl: source.url,
      };
    });
  }
}
