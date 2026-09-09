# Bitácora — issue #295: VaultRetriever híbrido (vector + full-text + RRF)

## Qué se hizo

- **`src/application/vault-query/vault-retriever.ts`** — `VaultRetriever.retrieve(question, opts?)`:
  embebe la pregunta (`inputType: 'query'`), consulta **dos ramas en paralelo** —vector
  (`embedding <=> $q`) y full-text español (`contentTsv @@ websearch_to_tsquery('spanish', $q)`,
  orden `ts_rank_cd`)— y las fusiona con **Reciprocal Rank Fusion** (`k = 60`). Cada rama pide 20
  candidatos; devuelve el top `limit` (default 5). `opts.namespaces` acota por `sourceType`.
- **`vault-chunk-repository.ts`** — `searchChunks` se partió en `searchByVector` y
  `searchByFullText` (ambas devuelven `VaultSearchHit` con `sourceType` y `distance` nullable, sin
  filtro de distancia — el ranking lo hace RRF). El `IN` sobre el enum usa `"sourceType"::text`.
- **`VaultQueryService`** — deja de hacer `embed` + `searchChunks(0.65)` + reintento `0.85`. Ahora
  llama `retriever.retrieve()`. La confianza HIGH ahora exige que **al menos un chunk tenga un
  match semántico directo** (`distance < 0.65`); si vino todo por full-text o por vecinos lejanos,
  LOW. El constructor pasó de `(embedder, ai, repo)` a `(retriever, ai)`.
- `retrieverVersion` en `vault_query_log` pasa a `v2-hybrid-rrf`; `chunksReturned` ahora incluye
  `rrfScore`.

## Decisiones

- **RRF en vez de normalizar y sumar scores**: las dos ramas no son comparables (coseno vs
  `ts_rank_cd`); RRF solo usa el *orden*, es el estándar y no tiene hiperparámetros más allá de
  `k=60` (valor del paper).
- **20 candidatos por rama fijo** (`CANDIDATE_POOL`): F1-08 mete el reranker entre esos 20 y el
  top-5. Se dejó como constante para que ese cambio sea local.
- **El reintento "widened → LOW" desaparece** como mecanismo (era un parche para lo que ahora
  resuelve el full-text), pero la *semántica* se conserva: la confianza sigue siendo LOW cuando no
  hay un match vector cercano.
- `VaultRetriever` **lanza** `UnprocessableEntityError` si no puede embeber (mismo comportamiento
  que antes tenía el servicio). El chequeo `!embedder.isConfigured` del servicio se sacó: el
  `embed()` ya devuelve `null` sin config y el retriever lo traduce al mismo error.

## Fuera de alcance

Re-ranking con Voyage (#298, F1-08). Contextual retrieval (#297). Recalibrar el umbral `0.65` con
datos de `vault_query_log` (#302/F2-03). El clasificador.

## Verificación

```
npm run typecheck · check:tests-base · eslint             # verde
npx vitest run tests/application/vault-retriever.test.ts tests/application/vault-query-service.test.ts   # 13 verdes (fuseRRF puro + servicio)
npx vitest run --config vitest.integration.config.ts tests/integration/vault-retriever.test.ts tests/integration/vault-query-log.test.ts
  # 6 verdes, rol costear_app — sigla exacta por FTS, filtro por namespace, doble match arriba
npx vitest run --exclude 'tests/http/**'                  # 1517 verdes, 1 skip
npx vitest run tests/http --no-file-parallelism           # 85 verdes
```
