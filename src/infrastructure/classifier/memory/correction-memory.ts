// src/infrastructure/classifier/memory/correction-memory.ts
import { prisma } from '../../database/prisma.js';

interface AuditSignal { label?: string }

/**
 * Memoria de correcciones — recuperación few-shot determinista.
 *
 * Cuando un documento es ambiguo y va a la IA, le damos como ejemplos las
 * clasificaciones que ESTE costista ya validó o corrigió en casos parecidos.
 * Así la IA sigue el criterio real de la operación en vez de adivinar.
 *
 * No usa embeddings ni dependencias externas: la similitud se mide por
 * solapamiento de señales detectadas + mismo rubro. Es explicable y barata.
 * Cualquier fallo de DB es no-fatal (devuelve undefined → la IA clasifica sin memoria).
 */
export async function getCorrectionExamples(params: {
  costistId: string;
  industryCategory: string;
  foundLabels: string[];
  limit?: number;
}): Promise<string | undefined> {
  const { costistId, industryCategory, foundLabels, limit = 3 } = params;

  try {
    // Traemos las validaciones recientes del costista (verdad de oro).
    const audits = await prisma.classificationAudit.findMany({
      where: { costistId, validatedByCostista: true },
      orderBy: { costaValidatedAt: 'desc' },
      take: 60,
      select: {
        documentType: true,
        costSection: true,
        costaOverrode: true,
        costaCorrection: true,
        corroboratingSignals: true,
        industryCategory: true,
        definitiveSignal: true,
      },
    });

    if (audits.length === 0) return undefined;

    const wanted = new Set(foundLabels);

    const scored = audits.map((a) => {
      const sigs = Array.isArray(a.corroboratingSignals)
        ? (a.corroboratingSignals as AuditSignal[])
        : [];
      const labels = new Set<string>();
      for (const s of sigs) if (s?.label) labels.add(s.label);
      if (a.definitiveSignal) labels.add(a.definitiveSignal);

      // Similitud = cantidad de señales en común.
      let overlap = 0;
      for (const l of labels) if (wanted.has(l)) overlap++;

      // Bonus por mismo rubro: criterios de costo dependen del rubro.
      const sameIndustry = a.industryCategory === industryCategory ? 1 : 0;

      return { audit: a, score: overlap * 2 + sameIndustry };
    });

    // Solo ejemplos con alguna relación real (score > bonus de rubro solo).
    const relevant = scored
      .filter((s) => s.score >= 2)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    if (relevant.length === 0) return undefined;

    const lines = relevant.map(({ audit }) => {
      const correction = audit.costaCorrection as { type?: string; section?: string } | null;
      const truthType = (audit.costaOverrode && correction?.type) ? correction.type : audit.documentType;
      const truthSection = (audit.costaOverrode && correction?.section) ? correction.section : audit.costSection;
      const verb = audit.costaOverrode ? 'corregiste a' : 'confirmaste como';
      return `- Un caso similar lo ${verb}: tipo ${truthType}, sección ${truthSection}.`;
    });

    return lines.join('\n');
  } catch {
    return undefined;
  }
}
