import type { IndustryCategory } from '../types.js';
import type { IndustryProfile as TSIndustryProfile } from './industry-profile.js';
import { prisma } from '../../database/prisma.js';

type DbRow = {
  category: string;
  label: string;
  mpKeywords: string[];
  cipKeywords: string[];
  modKeywords: string[];
  eventKeywords: string[];
  lossKeywords: string[];
  energyIsMP: boolean;
  fuelIsMP: boolean;
  detectPatterns: string[];
  measurementUnit: string | null;
  isActive: boolean;
};

function toProfile(row: DbRow): TSIndustryProfile {
  return {
    category: row.category as IndustryCategory,
    label: row.label,
    mpKeywords: row.mpKeywords,
    cipKeywords: row.cipKeywords,
    modKeywords: row.modKeywords,
    eventKeywords: row.eventKeywords,
    lossKeywords: row.lossKeywords,
    energyIsMP: row.energyIsMP,
    fuelIsMP: row.fuelIsMP,
  };
}

const CACHE_TTL_MS = 5 * 60 * 1000;

class IndustryProfileService {
  private cache: Map<string, TSIndustryProfile> = new Map();
  private cacheLoadedAt = 0;

  private get isCacheStale(): boolean {
    return Date.now() - this.cacheLoadedAt > CACHE_TTL_MS;
  }

  private async loadCache(): Promise<void> {
    const rows = await prisma.industryProfile.findMany({
      where: { isActive: true },
    });
    this.cache = new Map(rows.map((r) => [r.category, toProfile(r)]));
    this.cacheLoadedAt = Date.now();
  }

  private async ensureCache(): Promise<void> {
    if (this.cache.size === 0 || this.isCacheStale) {
      await this.loadCache();
    }
  }

  async getProfile(category: IndustryCategory): Promise<TSIndustryProfile | null> {
    await this.ensureCache();
    return this.cache.get(category) ?? null;
  }

  async getAllProfiles(): Promise<TSIndustryProfile[]> {
    await this.ensureCache();
    return [...this.cache.values()];
  }

  /** Fuerza recarga del caché en el próximo acceso (útil tras un upsert de admin). */
  invalidateCache(): void {
    this.cacheLoadedAt = 0;
  }
}

export const industryProfileService = new IndustryProfileService();
