import { prisma } from '../../database/prisma.js';
import type { IndustryCategory } from '../types.js';
import type { IndustryProfile } from './industry-profile.js';

type VocabularyTerm = {
  termino: string;
  variantes: string[];
  seccion: string;
};

const KEYWORDS_BY_SECTION = {
  MATERIA_PRIMA: 'mpKeywords',
  COSTOS_INDIRECTOS: 'cipKeywords',
  MANO_DE_OBRA: 'modKeywords',
} as const;

type KeywordProfileField = (typeof KEYWORDS_BY_SECTION)[keyof typeof KEYWORDS_BY_SECTION];

function uniqueKeywords(keywords: readonly string[]): string[] {
  return [...new Set(keywords.filter((keyword) => keyword.trim() !== ''))];
}

/**
 * Suma las filas de vocabulario que el routing actual puede interpretar a las
 * mismas listas de keywords estáticas que ya consume Layer 4. No cambia pesos,
 * umbrales ni el orden del cascade: solo agrega señales del rubro elegido.
 *
 * `VENTAS` y `NO_APLICA` no se convierten en keywords de Layer 4 porque el
 * ruteador de compras no tiene una lista equivalente para esas secciones.
 */
export function withVocabularyTerms(
  profile: IndustryProfile,
  terms: readonly VocabularyTerm[],
): IndustryProfile {
  const keywords: Record<KeywordProfileField, string[]> = {
    mpKeywords: [...profile.mpKeywords],
    cipKeywords: [...profile.cipKeywords],
    modKeywords: [...profile.modKeywords],
  };

  for (const term of terms) {
    const field = KEYWORDS_BY_SECTION[term.seccion as keyof typeof KEYWORDS_BY_SECTION];
    if (field) keywords[field].push(term.termino, ...term.variantes);
  }

  return {
    ...profile,
    mpKeywords: uniqueKeywords(keywords.mpKeywords),
    cipKeywords: uniqueKeywords(keywords.cipKeywords),
    modKeywords: uniqueKeywords(keywords.modKeywords),
  };
}

/** Lee únicamente el vocabulario activo del rubro que se está clasificando. */
export async function getActiveVocabularyTerms(
  industryCategory: IndustryCategory,
): Promise<VocabularyTerm[]> {
  // La suite unitaria y herramientas offline corren sin una base configurada.
  // En ese contexto el perfil estático conserva el comportamiento anterior y
  // evitamos intentar una conexión Prisma que solo agregaría ruido al test.
  if (!process.env.DATABASE_URL) return [];

  return prisma.vocabularioTermino.findMany({
    where: { industryCategory, isActive: true },
    select: { termino: true, variantes: true, seccion: true },
  });
}
