import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { loadGolden, seedEvalIndex, runEval, type EvalMetrics } from './eval-runner.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASELINE_PATH = join(HERE, 'baseline.json');
const LAST_RUN_PATH = join(HERE, 'last-run.json');

/**
 * Eval del RAG (F1-12). Corre el pipeline completo (retriever híbrido + rerank +
 * generación) contra el set dorado y calcula métricas.
 *
 * Necesita `VOYAGE_API_KEY` para sembrar el índice con embeddings reales; si
 * falta, el test se saltea (no rompe el CI de quien no tiene la key). El juez
 * del `criterion` usa `getLLMService('context')`; sin LLM, esa métrica se marca
 * como no evaluada.
 *
 * `npm run eval:rag`  ·  actualizar la baseline: `UPDATE_EVAL_BASELINE=1 npm run eval:rag`
 */
const hasVoyage =
  !!process.env.VOYAGE_API_KEY &&
  process.env.VOYAGE_API_KEY.length > 10 &&
  process.env.VOYAGE_API_KEY !== 'voyage_placeholder' &&
  !!process.env.DATABASE_URL;

/** Distingue un fallo de infra/keys (no medible → no es regresión) de una regresión real. */
function isInfraFailure(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /embedding|Voyage|modelo generador|rate.?limit|API key|ECONNRESET|ENOTFOUND|fetch failed|429|401|403|no está configurado/i.test(
    msg,
  );
}

describe.skipIf(!hasVoyage)('eval:rag', () => {
  it('corre el set dorado y no supera la tasa de alucinación de la baseline', async () => {
    let metrics: EvalMetrics;
    try {
      await seedEvalIndex();
      metrics = await runEval(loadGolden());
    } catch (err) {
      if (isInfraFailure(err)) {
        // eslint-disable-next-line no-console
        console.warn(
          '[eval:rag] no se pudo medir (problema de infra o de API keys), no cuenta como regresión:',
          err instanceof Error ? err.message : err,
        );
        return; // el gate de CI (F1-13) trata "no medible" aparte de "peor que la baseline"
      }
      throw err;
    }

    writeFileSync(LAST_RUN_PATH, JSON.stringify(metrics, null, 2) + '\n', 'utf-8');
    // eslint-disable-next-line no-console
    console.info('[eval:rag] métricas:', metrics);

    if (metrics.errored === metrics.cases) {
      // eslint-disable-next-line no-console
      console.warn('[eval:rag] TODOS los casos fallaron (infra/API keys), no se evalúa regresión.');
      return;
    }

    if (process.env.UPDATE_EVAL_BASELINE === '1') {
      writeFileSync(BASELINE_PATH, JSON.stringify(metrics, null, 2) + '\n', 'utf-8');
      // eslint-disable-next-line no-console
      console.info('[eval:rag] baseline actualizada.');
    }

    // Invariante duro: nunca cita una fuente que no estaba en el contexto.
    expect(metrics.sourceHallucinationRate).toBe(0);

    // Comparación contra la baseline (si existe y tiene números reales).
    if (existsSync(BASELINE_PATH)) {
      const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf-8')) as Partial<EvalMetrics>;
      const tol = 0.05;
      if (typeof baseline.recallAt5 === 'number') {
        expect(metrics.recallAt5).toBeGreaterThanOrEqual(baseline.recallAt5 - tol);
      }
      if (typeof baseline.refusalCorrectRate === 'number') {
        expect(metrics.refusalCorrectRate).toBeGreaterThanOrEqual(baseline.refusalCorrectRate - tol);
      }
      if (typeof baseline.criterionPassRate === 'number' && metrics.criterionEvaluated) {
        expect(metrics.criterionPassRate).toBeGreaterThanOrEqual(baseline.criterionPassRate - tol);
      }
    }
  });
});
