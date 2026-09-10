import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * EVAL DEL RAG (F1-12) — `npm run eval:rag`.
 *
 * Aparte de las otras suites: corre el pipeline completo (retriever + rerank +
 * generación) contra el set dorado y necesita `VOYAGE_API_KEY` (embeddings
 * reales) y una base Postgres viva. Sin la key, el test se saltea solo.
 *
 * Local:  docker compose up -d postgres && npm run eval:rag
 * Baseline: UPDATE_EVAL_BASELINE=1 npm run eval:rag
 */
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/rag/eval.test.ts'],
    fileParallelism: false,
    testTimeout: 300_000, // el eval llama a Voyage + LLM por cada caso
    hookTimeout: 120_000,
  },
});
