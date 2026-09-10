import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { prisma } from '@/infrastructure/database/prisma.js';
import { VaultIndexerService } from '@/application/vault-indexer/vault-indexer-service.js';
import { VaultQueryService } from '@/application/vault-query/vault-query-service.js';
import { getLLMService } from '@/infrastructure/ai/llm-service.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const CORPUS_DIR = join(HERE, 'fixtures', 'eval-corpus');
export const GOLDEN_PATH = join(HERE, 'golden', 'starter.json');

export interface GoldenCase {
  id: string;
  question: string;
  expectedFiles: string[];
  mustAnswer: boolean;
  criterion: string;
}

export interface EvalMetrics {
  cases: number;
  /** Fracción de archivos esperados presentes en los chunks devueltos (casos mustAnswer). */
  recallAt5: number;
  /** Fracción de casos mustAnswer:false en los que el RAG se negó correctamente. */
  refusalCorrectRate: number;
  /** Fracción de casos con al menos una cita a un archivo que NO estaba en el contexto. Objetivo: 0. */
  sourceHallucinationRate: number;
  /** Fracción de casos mustAnswer respondidos cuyas citas están todas entre las esperadas. */
  exactCitationRate: number;
  /** Fracción de casos mustAnswer respondidos cuyo `answer` satisface el `criterion` (juez Claude). */
  criterionPassRate: number;
  /** null si no había un LLM para el juez. */
  criterionEvaluated: boolean;
  /** Casos que fallaron por error de infra/API (no cuentan como regresión). */
  errored: number;
}

export function loadGolden(path = GOLDEN_PATH): GoldenCase[] {
  const raw = JSON.parse(readFileSync(path, 'utf-8')) as { cases: GoldenCase[] };
  return raw.cases;
}

/** Reindexa la bóveda con el corpus de evaluación. NUNCA en producción. */
export async function seedEvalIndex(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('seedEvalIndex jamás debe correr en producción: borra vault_chunks.');
  }
  await prisma.vaultChunk.deleteMany({});
  const indexer = new VaultIndexerService();
  const result = await indexer.indexVault(CORPUS_DIR);
  if (result.filesWithErrors.length > 0) {
    throw new Error(`Corpus de eval con errores: ${result.filesWithErrors.join(', ')}`);
  }
}

const judgeSchema = z.object({ pass: z.boolean() });

async function judge(answer: string, criterion: string): Promise<boolean | null> {
  const llm = getLLMService('context');
  if (!llm.isConfigured) return null;
  const res = await llm.completeJSON(
    'Sos un evaluador. Te doy una RESPUESTA y un CRITERIO. Respondé en JSON { "pass": boolean }: ' +
      'pass=true solo si la respuesta cumple el criterio.',
    `CRITERIO:\n${criterion}\n\nRESPUESTA:\n${answer}`,
    { schema: judgeSchema, maxTokens: 50 },
  );
  return res?.pass ?? null;
}

export async function runEval(cases: GoldenCase[]): Promise<EvalMetrics> {
  const svc = new VaultQueryService();

  let recallNum = 0;
  let recallDen = 0;
  let refusalOk = 0;
  let refusalTotal = 0;
  let hallucinated = 0;
  let exactCitOk = 0;
  let exactCitTotal = 0;
  let criterionOk = 0;
  let criterionTotal = 0;
  let criterionEvaluated = false;
  let errored = 0;

  for (const c of cases) {
    let res: Awaited<ReturnType<VaultQueryService['query']>>;
    try {
      res = await svc.query(c.question);
    } catch (err) {
      errored++;
      // eslint-disable-next-line no-console
      console.warn(`[eval:rag] caso "${c.id}" falló:`, err instanceof Error ? err.message : err);
      continue;
    }

    // Archivos realmente recuperados (desde vault_query_log).
    let returnedFiles: string[] = [];
    if (res.queryLogId) {
      const log = await prisma.vaultQueryLog.findUnique({ where: { id: res.queryLogId } });
      const chunks = (log?.chunksReturned as Array<{ sourceFile: string }> | null) ?? [];
      returnedFiles = [...new Set(chunks.map((x) => x.sourceFile))];
    }

    // Alucinación de fuente: cita algo que no estaba en el contexto.
    if (res.citations.some((cit) => !returnedFiles.includes(cit))) hallucinated++;

    if (c.mustAnswer) {
      // recall@5
      recallDen += c.expectedFiles.length;
      recallNum += c.expectedFiles.filter((f) => returnedFiles.includes(f)).length;

      const answered = res.confidence !== 'NONE';
      if (answered) {
        exactCitTotal++;
        if (res.citations.length > 0 && res.citations.every((cit) => c.expectedFiles.includes(cit))) {
          exactCitOk++;
        }
        const verdict = await judge(res.answer, c.criterion);
        if (verdict !== null) {
          criterionEvaluated = true;
          criterionTotal++;
          if (verdict) criterionOk++;
        }
      }
    } else {
      refusalTotal++;
      if (res.confidence === 'NONE') refusalOk++;
    }
  }

  return {
    cases: cases.length,
    recallAt5: recallDen > 0 ? recallNum / recallDen : 1,
    refusalCorrectRate: refusalTotal > 0 ? refusalOk / refusalTotal : 1,
    sourceHallucinationRate: cases.length > 0 ? hallucinated / cases.length : 0,
    exactCitationRate: exactCitTotal > 0 ? exactCitOk / exactCitTotal : 1,
    criterionPassRate: criterionTotal > 0 ? criterionOk / criterionTotal : 1,
    criterionEvaluated,
    errored,
  };
}
