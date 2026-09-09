import type { PrismaClient } from '@prisma/client';
import { prisma, withTenant } from '../../infrastructure/database/prisma.js';
export const CORE_DEFAULTS: Record<string, unknown> = { 'lexicon.UnidadProductiva': 'Unidad productiva', 'lexicon.LoteProductivo': 'Lote', 'screens.dashboard': 'dashboard' };
export interface PackageScope { companyId?: string; structureId?: string; periodId?: string }
export interface ResolvedPackage {
  category: string;
  defaults: Record<string, unknown>;
  /** Configuración de calibración opcional: { value, unit }. */
  scale?: unknown;
  [key: string]: unknown;
}
export class PaqueteRubroService {
  constructor(private readonly db: PrismaClient = prisma) {}
  async resolve(userId: string, category: string, scope: PackageScope = {}): Promise<ResolvedPackage> {
    const rows = await withTenant(userId, (tx) => tx.paqueteRubro.findMany({ where: { category, OR: [{ userId: null }, { userId }] } }));
    const eligible = rows.filter((r) => (!r.companyId || r.companyId === scope.companyId) && (!r.structureId || r.structureId === scope.structureId) && (!r.periodId || r.periodId === scope.periodId));
    const rank = (r: typeof rows[number]) => (r.periodId ? 8 : 0) + (r.structureId ? 4 : 0) + (r.companyId ? 2 : 0) + (r.userId ? 1 : 0);
    eligible.sort((a, b) => rank(a) - rank(b));
    const result: Record<string, unknown> = {};
    for (const row of eligible) {
      Object.assign(result, { lexicon: row.lexicon, icons: row.icons, variants: row.variants, seedParameters: row.seedParameters, alertRules: row.alertRules, screens: row.screens });
      // Un override sin escala no borra la calibración menos específica: la
      // ausencia es ausencia declarada, no un valor por defecto plausible.
      if (row.scale !== null) result.scale = row.scale;
    }
    return { category, ...result, defaults: CORE_DEFAULTS };
  }
}
