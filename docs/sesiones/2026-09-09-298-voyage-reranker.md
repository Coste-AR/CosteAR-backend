# Bitácora — issue #298: re-ranking con Voyage rerank-2.5

## Qué se hizo

- **`src/infrastructure/ai/voyage-reranker.ts`** — `VoyageReranker.rerank(query, documents, topK)`:
  `POST https://api.voyageai.com/v1/rerank` (modelo `rerank-2.5`), vía `voyageFetch` (respeta el
  rate limit). Devuelve `{ index, score }[]` ordenados por relevancia descendente. `null` si no
  está configurado, si la lista está vacía, o si la API falla — degradación segura. `getEnv()`
  perezoso (el retriever que lo instancia puede construirse sin el entorno completo).
- **`VaultRetriever`** — 3er parámetro `reranker`. Después de fusionar con RRF, si hay reranker
  reordena los candidatos por su score y trunca a `limit`; si no, `slice(0, limit)` por RRF.
  `RetrievedChunk` suma `rerankScore: number | null`.
- `RETRIEVER_VERSION` pasa a `v3-hybrid-rrf-rerank`. `chunksReturned` en `vault_query_log` ahora
  incluye `rerankScore`.

## Decisiones

- **`rerank()` devuelve el score, no solo el índice** (el plan decía `number[]`). El
  `relevance_score` es útil para los evals (#302) y la observabilidad del panel; el costo es
  cero.
- **Candidatos al reranker = todos los del pool RRF** (hasta ~40: 20 vector + 20 FTS, menos
  solapados). El plan menciona "20 vs 50" a decidir con evals — con `CANDIDATE_POOL=20` por rama
  el pool efectivo ya está en ese rango; ajustarlo es cambiar una constante.
- El reranker se salta si `documents.length === 0` para no gastar una llamada.

## Fuera de alcance

Elegir el número final de candidatos con datos (#302 / F2-03). El clasificador.

## Verificación

```
npm run typecheck · eslint · check:tests-base            # verde
npx vitest run tests/infrastructure/voyage-reranker.test.ts tests/application/vault-retriever.test.ts
  # 10 verdes: orden por score, null sin config / lista vacía / error de API, reordenado + truncado
npx vitest run --config vitest.integration.config.ts tests/integration/vault-retriever.test.ts tests/integration/vault-query-log.test.ts   # 6 verdes
npx vitest run --exclude 'tests/http/**'                 # 1528 verdes, 1 skip
npx vitest run tests/http --no-file-parallelism          # 87 verdes
```
