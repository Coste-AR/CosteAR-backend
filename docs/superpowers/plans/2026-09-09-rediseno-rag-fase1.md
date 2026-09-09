# Rediseño RAG — Fase 1 · plan de ejecución (issues)

> **Formato:** un bloque por issue, listo para `/costear-issue`. No es un plan TDD paso a paso
> porque el modelo del equipo es issue → agente; cada issue trae objetivo, contexto, archivos,
> criterios de aceptación verificables, dependencias y fuera de alcance.
>
> **Spec:** `docs/superpowers/specs/2026-09-09-rediseno-rag-design.md`
> **Comparación:** `docs/superpowers/specs/2026-09-09-rag-actual-vs-planeado.md`

## Constraints globales (aplican a TODOS los issues)

- Node 22 · TS strict · **npm** (nunca pnpm/yarn) · Prisma + Postgres.
- **Migraciones aditivas** (DOM-06): `CREATE TABLE`, `ALTER ADD COLUMN`. Nada de `DROP` sobre
  tablas con datos. Correr con `npm run prisma:migrate <nombre>` (no `prisma migrate dev` crudo).
- Toda mutación nueva escribe su bitácora en la misma transacción (DOM-02).
- **Ningún 500 crudo** al usuario: errores → 4xx con `{code, message, field?}` en español (DOM-04).
- El RAG conserva sus invariantes RAG-INV-01..06 del spec (cero alucinaciones, degradación segura,
  trazabilidad, no vaciar la bóveda, `sourceFile` de IA nunca es ruta de confianza).
- **Datos de cliente jamás en repos públicos** (`CosteAR-backend` es público): tests con datos
  ficticios que ejerciten la misma lógica (CLI-01/02).
- Cada issue: `lint` + `typecheck` + la suite que corresponda en verde localmente antes de marcar
  el PR listo; pegar la salida en el PR (REV-01).
- Bitácora de sesión en `docs/sesiones/AAAA-MM-DD-<issue>-<slug>.md` en el mismo PR.

---

## F1-01 · Contrato de bóveda: `.vaultignore` + frontmatter `index: false`

**Objetivo:** que el indexador deje de meter documentación de devs (specs, mockups, testing) al
índice del RAG.

**Contexto:** `src/application/vault-indexer/vault-indexer-service.ts` `listMarkdownFiles()`
indexa todo `.md` salvo el `README.md` de la raíz, con `IGNORED_DIRS` hardcodeado
(`.obsidian`, `.trash`, `.git`). El repo bóveda tiene `costeo-procesos/spec/HANDOFF-DEVS…`,
`.../testing/…` que son proyecto, no metodología.

**Archivos:**
- Modificar: `src/application/vault-indexer/vault-indexer-service.ts` (`listMarkdownFiles`,
  `IGNORED_DIRS`)
- Crear: `src/application/vault-indexer/vault-filter.ts` (parseo de `.vaultignore` + frontmatter)
- Test: `tests/application/vault-filter.test.ts`

**Criterios de aceptación:**
- [ ] Si existe un archivo `.vaultignore` en la raíz del vault, sus globs (sintaxis gitignore) se
      excluyen del listado. Sin `.vaultignore`, comportamiento actual.
- [ ] Una nota con frontmatter `index: false` no se indexa aunque no matchee ningún glob.
- [ ] `IGNORED_DIRS` sigue vigente como piso mínimo (no se puede "des-ignorar" `.git`).
- [ ] La salvaguarda de "cero notas .md → error, no borra nada" (RAG-INV-04) sigue intacta.

**Test:** unitario. Fixture de directorio temporal con `.vaultignore`, notas con y sin
`index: false`, y notas normales. Asertar el set de rutas devuelto.

**Depende de:** — · **Fuera de alcance:** mover archivos en el repo bóveda (eso es F1-02).

---

## F1-02 · Reestructura del repo `costear-knowledge-base`

**Objetivo:** separar `conocimiento/` (indexable) de `interno/` (no) y crear el destino del
aprendizaje aprobado.

**Contexto:** repo `Coste-AR/costear-knowledge-base`. Hoy: `001.1 - Clases (Mirta)/` (45 clases),
`costeo-procesos/` (mezcla corpus P1-P4 + spec + mockups + testing).

**Archivos (en el repo bóveda, PR aparte):**
- `conocimiento/catedra/` ← `001.1 - Clases (Mirta)/` (con `git mv`, sin perder historia)
- `conocimiento/procesos/` ← `costeo-procesos/corpus-catedra/`
- `conocimiento/aprendizaje/.gitkeep` (destino de ediciones aprobadas)
- `interno/` ← `costeo-procesos/spec/`, `costeo-procesos/mockups/`, `costeo-procesos/testing/`
- `.vaultignore` con `interno/` y `Reportes_Nocturnos/`
- `README.md`: documentar la estructura y qué se indexa

**Criterios de aceptación:**
- [ ] `git log --follow` sobre una clase movida muestra su historia completa.
- [ ] `.vaultignore` excluye `interno/` y `Reportes_Nocturnos/`.
- [ ] El indexador (con F1-01) sobre la estructura nueva indexa solo `conocimiento/**`.
- [ ] PR coordinado con F1-01: durante la ventana de migración el indexador tolera ambas
      estructuras (no explota si `conocimiento/` todavía no existe).

**Test:** correr `npm run vault:index -- <checkout de la rama del PR bóveda>` y verificar
`filesProcessed` = cantidad de notas bajo `conocimiento/`, `filesWithErrors` vacío.

**Depende de:** F1-01 · **Fuera de alcance:** cargar contenido nuevo (F1-03).

---

## F1-03 · Auditoría de contenido con la cátedra

**Objetivo:** confirmar qué conocimiento falta en la bóveda (la queja "no está actualizada" puede
ser el loop roto **y/o** material humano sin subir).

**Contexto:** el repo está congelado desde 2026-07-28. 45 clases + corpus P1-P4. No sabemos si hay
clases posteriores, apuntes, correcciones de la cátedra, o si el corpus de procesos está completo.

**Entregable:** un documento `docs/sesiones/…-auditoria-boveda.md` (o issue-comment) con:
- [ ] Checklist contra el programa de la cátedra: ¿qué clases/temas existen y cuáles están en la
      bóveda?
- [ ] Lista de material identificado como faltante, con responsable de conseguirlo.
- [ ] Confirmación de si `conocimiento/procesos/` (P1-P4) cubre todo el vertical de procesos o
      falta.
- [ ] Recomendación: ¿la bóveda necesita una carga humana antes de activar el loop, o el loop
      alcanza?

**Depende de:** — (puede correr en paralelo) · **Fuera de alcance:** escribir el contenido
faltante (se abren issues aparte según lo que salga).

---

## F1-04 · Chunker recursivo con solape

**Objetivo:** que una nota sin subtítulos deje de ser un chunk gigante y que los H4+ no se
pierdan.

**Contexto:** `src/application/vault-indexer/markdown-chunker.ts` parte solo por H2/H3. H4+ se
aplanan. Sin solape. Tiene tests en `tests/` (buscar `markdown-chunker` / `chunkMarkdown`).

**Archivos:**
- Modificar: `src/application/vault-indexer/markdown-chunker.ts`
- Test: el archivo de test existente de `chunkMarkdown` (extender, no reescribir)

**Criterios de aceptación:**
- [ ] Un bloque de sección > ~800 tokens se subdivide por párrafos; un párrafo > ~800 tokens, por
      oraciones.
- [ ] Chunks contiguos de la misma sección comparten ~1 párrafo de solape.
- [ ] Los H4+ aparecen en `headingPath` (ej. `"CIP > Prorrateo > Base horas máquina"`), no se
      descartan.
- [ ] `contentHash` sigue siendo `sha256(headingPath + "\n" + content)` (se ajusta en F1-05 para
      incluir el prefijo contextual).
- [ ] Los casos existentes del test (frontmatter, fence-aware H1, H1 múltiple) siguen pasando.

**Test:** unitario. Nota larga sin H2, nota con H4 anidados, nota con un párrafo enorme. Asertar
cantidad de chunks, `headingPath`, y que el solape existe.

**Depende de:** — · **Fuera de alcance:** contextual retrieval (F1-05), re-embeddeo (lo hace el
indexador por hash).

---

## F1-05 · Contextual Retrieval (prefijo por chunk)

**Objetivo:** anteponer a cada chunk 1-2 frases de contexto del documento antes de embeber
(técnica de Anthropic; ~35% mejor retrieval).

**Contexto:** hoy se embebe `chunk.content` pelado. `VoyageService.embed()` en
`src/infrastructure/ai/voyage-service.ts`.

**Archivos:**
- Modificar: `src/application/vault-indexer/vault-indexer-service.ts` (fase 2, antes de embeber)
- Modificar: `src/application/vault-indexer/markdown-chunker.ts` (agregar `contextualPrefix` al
  tipo `MarkdownChunk`, incluirlo en `contentHash`)
- Usar: la capa `LLMService` de F1-09 (Claude Haiku) con Batch API + prompt caching del documento
- Test: `tests/application/vault-indexer-service.test.ts` (o el que exista) + unitario del hash

**Criterios de aceptación:**
- [ ] Antes de embeber un chunk nuevo/cambiado, se genera un `contextualPrefix` (1-2 frases: de
      qué trata el documento y dónde encaja el fragmento) con Claude Haiku.
- [ ] Se embebe `contextualPrefix + "\n\n" + content`.
- [ ] `contentHash` incluye `contextualPrefix` → un cambio de prefijo re-embebe; sin cambios, no.
- [ ] La generación usa Batch API (–50%) y cachea el documento completo entre chunks del mismo
      archivo.
- [ ] Si `LLMService` no está configurado, el indexador sigue funcionando embebiendo el `content`
      pelado (degradación segura) y lo registra.

**Test:** unitario con `LLMService` fakeado — verificar que el texto embebido incluye el prefijo,
que el hash cambia con el prefijo, y que sin LLM configurado cae al content pelado.

**Depende de:** F1-04, F1-09 · **Fuera de alcance:** cambiar el modelo de embeddings.

---

## F1-06 · Schema: `vault_chunks.sourceType` + `contextualPrefix`

**Objetivo:** namespaces por fuente + persistir el prefijo contextual.

**Contexto:** `prisma/schema.prisma` modelo `VaultChunk` (`@@map("vault_chunks")`). Tiene
`embedding Unsupported("vector(1024)")` y `contentTsv Unsupported("tsvector")` con índices en SQL
crudo — **rechazar cualquier prompt de Prisma que quiera borrarlos** (CMD-05).

**Archivos:**
- Modificar: `prisma/schema.prisma` (modelo `VaultChunk`, nuevo enum `VaultSourceType`)
- Crear: `prisma/migrations/<ts>_add_vault_chunk_sourcetype_context/migration.sql`
- Modificar: `src/application/vault-indexer/vault-chunk-repository.ts` (`UpsertChunkInput`,
  `upsertChunk` SQL)
- Test: `tests/integration/` (nuevo o existente de vault_chunks) — declararlo en
  `tests/db-dependent.mjs`

**Criterios de aceptación:**
- [ ] `sourceType` enum `CATEDRA | PROCESOS | APRENDIZAJE`, nullable con backfill: se deriva del
      primer segmento de `sourceFile` (`conocimiento/catedra/…` → `CATEDRA`, etc.).
- [ ] `contextualPrefix` text nullable.
- [ ] Migración **aditiva**, sin `DROP`. `npm run prisma:migrate` no reporta deriva nueva.
- [ ] `upsertChunk` persiste ambos campos; el `ON CONFLICT` los actualiza.
- [ ] `npm run check:tests-base` en verde.

**Test:** integración con rol `costear_app` (sin BYPASSRLS): upsert de un chunk con `sourceType` y
prefijo, releer, verificar.

**Depende de:** — · **Fuera de alcance:** usar `sourceType` en el retrieval (F1-07) o la UI (F2).

---

## F1-07 · `VaultRetriever` — búsqueda híbrida vector + full-text con RRF

**Objetivo:** dejar de depender solo del coseno; usar la columna `contentTsv` que ya existe.

**Contexto:** `src/application/vault-indexer/vault-chunk-repository.ts` `searchChunks()` hace solo
`embedding <=> $1`. Consumidores: `VaultQueryService` (`src/application/vault-query/`).

**Archivos:**
- Crear: `src/application/vault-query/vault-retriever.ts` (`VaultRetriever`)
- Modificar: `src/application/vault-query/vault-query-service.ts` (usar `VaultRetriever` en vez de
  `repo.searchChunks` directo)
- Modificar: `vault-chunk-repository.ts` — agregar `searchByFullText(query, limit)` y conservar
  `searchByVector` (renombre de `searchChunks`)
- Test: `tests/integration/vault-retriever.test.ts` (declarar en `tests/db-dependent.mjs`)

**Interfaz que produce:**
```ts
interface RetrievedChunk {
  id: string; sourceFile: string; sourceTitle: string;
  headingPath: string | null; content: string;
  sourceType: VaultSourceType;
  vectorRank?: number; ftsRank?: number; rrfScore: number;
}
class VaultRetriever {
  retrieve(question: string, opts?: {
    candidates?: number;   // default 20
    namespaces?: VaultSourceType[];
  }): Promise<RetrievedChunk[]>;
}
```

**Criterios de aceptación:**
- [ ] Rama vector: `embedding <=> $q` (embed de la pregunta con `inputType: 'query'`).
- [ ] Rama FTS: `contentTsv @@ websearch_to_tsquery('spanish', $q)`, orden `ts_rank_cd`.
- [ ] Fusión **RRF** con `k = 60`: `score = Σ 1/(k + rank_i)` sobre las posiciones en cada rama.
- [ ] Devuelve `candidates` (default 20) ordenados por `rrfScore` desc.
- [ ] `namespaces` filtra por `sourceType IN (...)` en ambas ramas.
- [ ] Una pregunta con una sigla exacta de la cátedra que hoy cae en LOW (ej. "ITCS") aparece en
      los candidatos por la rama FTS.

**Test:** integración. Sembrar ~6 chunks (algunos con una sigla exacta, otros semánticamente
cercanos). Verificar que la sigla exacta entra por FTS y que el orden RRF es el esperado.

**Depende de:** F1-06 · **Fuera de alcance:** rerank (F1-08), tuneo de umbrales (F1-12).

---

## F1-08 · Re-ranking con `voyage rerank-2.5`

**Objetivo:** de los ~20 candidatos del híbrido, quedarse con los 5 mejores por relevancia real.

**Contexto:** Voyage expone `POST /v1/rerank`. Rate limiter existente:
`src/infrastructure/ai/voyage-rate-limiter.ts` (`voyageFetch`).

**Archivos:**
- Crear: `src/infrastructure/ai/voyage-reranker.ts` (`VoyageReranker`)
- Modificar: `src/application/vault-query/vault-retriever.ts` (paso de rerank al final)
- Test: `tests/application/voyage-reranker.test.ts` (fake de `voyageFetch`) + integración del
  retriever completo

**Interfaz:**
```ts
class VoyageReranker {
  readonly isConfigured: boolean;
  rerank(query: string, docs: string[], topK: number): Promise<number[] | null>; // índices ordenados
}
```

**Criterios de aceptación:**
- [ ] `VaultRetriever.retrieve()` llama al reranker sobre el `content` de los candidatos y devuelve
      `topK` (default 5) reordenados, con `rerankScore` en cada uno.
- [ ] Modelo `rerank-2.5`. Pasa por `voyageFetch` (respeta el rate limit).
- [ ] Si el reranker no está configurado o falla, se devuelven los primeros `topK` por `rrfScore`
      (degradación segura) y se registra.
- [ ] `candidates` al reranker es configurable (20 por default; los evals deciden 20 vs 50 — F1-12).

**Test:** unitario con `voyageFetch` fakeado devolviendo un orden conocido → verificar reordenado.
Integración: retriever completo con reranker fake, asertar `topK` y `rerankScore`.

**Depende de:** F1-07 · **Fuera de alcance:** elegir el número final de candidatos (F1-12).

---

## F1-09 · Capa `LLMService` provider-agnóstica (AI SDK)

**Objetivo:** una sola interfaz para generar con Claude o Groq, con structured output y telemetría.

**Contexto:** hoy `src/infrastructure/ai/groq-service.ts` (`completeJSON<T>`, `classifyDocument`,
`transcribeAudio`) es el único camino. No hay SDK de Anthropic. El usuario aprobó "Claude con
costo razonable". Ver `herramientas-a-evaluar.md` §2: usar **Vercel AI SDK** (`ai` +
`@ai-sdk/anthropic` + provider de Groq) en vez de un wrapper a mano.

**Archivos:**
- Crear: `src/infrastructure/ai/llm-service.ts` (interfaz `LLMService` + factory por caso de uso)
- Crear: `src/infrastructure/ai/anthropic-llm.ts` (impl AI SDK)
- Modificar: `src/infrastructure/ai/groq-service.ts` → `groq-llm.ts` (impl `LLMService`;
  `transcribeAudio` con cliente Groq directo, no va por el AI SDK)
- Modificar: `src/infrastructure/config/env.ts` — validar `ANTHROPIC_API_KEY`, `VAULT_GITHUB_TOKEN`,
  `VAULT_REINDEX_SECRET`; agregar `LLM_PROVIDER_VAULT_QUERY`, `LLM_PROVIDER_ADVISOR`,
  `LLM_PROVIDER_CONTEXT` (default `anthropic`), `LLM_MODEL_*`
- Modificar: `package.json` — `ai`, `@ai-sdk/anthropic`, provider Groq del AI SDK
- Test: `tests/infrastructure/llm-service.test.ts`

**Interfaz:**
```ts
interface LLMService {
  completeJSON<T>(system: string, user: string, opts?: {
    schema?: ZodSchema<T>;
    cacheSystem?: boolean;   // marca el system como cache_control
    maxTokens?: number;
  }): Promise<T | null>;
}
function getLLMService(useCase: 'vault_query' | 'advisor' | 'context' | 'classifier'): LLMService;
```

**Criterios de aceptación:**
- [ ] `completeJSON` con `schema` Zod devuelve el objeto tipado o `null` ante error (nunca lanza).
- [ ] `cacheSystem: true` marca el system prompt como `cache_control` en Anthropic; no-op en Groq.
- [ ] `getLLMService('vault_query')` y `'advisor'` devuelven Anthropic por default; `'classifier'`
      devuelve Groq (latencia); configurable por env.
- [ ] `experimental_telemetry` habilitado (spans OTel) — sin backend configurado, no rompe nada.
- [ ] `transcribeAudio` sigue disponible vía el cliente Groq directo.
- [ ] Sin `ANTHROPIC_API_KEY`, `getLLMService` cae a Groq y lo registra (degradación segura).

**Test:** unitario. Fakes de los providers. Verificar selección por caso de uso, fallback sin key,
que `completeJSON` nunca lanza.

**Depende de:** — · **Fuera de alcance:** migrar los consumidores (F1-10) y el clasificador.

---

## F1-10 · `vault-query` y `advisor` → Claude, contrato intacto

**Objetivo:** que el Q&A de la bóveda y el consejero generen con Claude, conservando
`{answer, citations, confidence}` y el filtrado de citas.

**Contexto:** `src/application/vault-query/vault-query-service.ts` y
`src/application/advisor/advisor-service.ts` usan `new GroqService()` directo.

**Archivos:**
- Modificar: `vault-query-service.ts` (inyectar `LLMService` vía `getLLMService('vault_query')`;
  `cacheSystem: true` en `QA_SYSTEM_PROMPT`; usar `VaultRetriever`)
- Modificar: `advisor-service.ts` (`getLLMService('advisor')`)
- Test: `tests/application/vault-query-service.test.ts`, `tests/application/advisor-service.test.ts`

**Criterios de aceptación:**
- [ ] `VaultQueryResult` sin cambios: `{ answer, citations, confidence: 'HIGH'|'LOW'|'NONE', fallbackMessage? }`.
- [ ] RAG-INV-01 intacto: `verifiedCitations` sigue filtrando contra los `sourceFile` realmente
      recuperados.
- [ ] El system prompt anti-alucinación va con `cacheSystem: true`.
- [ ] El reintento "widened → LOW" se conserva pero el umbral sale de un valor configurable
      (default el actual; F1-12 lo recalibra).
- [ ] Registro de `RAG_MISS` en `daily_signals` sin cambios.
- [ ] Tests existentes adaptados: el fake ahora es `LLMService`, no `GroqService`.
- [ ] Medir p95 de latencia de `query()` con el fake y dejar el número en la bitácora.

**Test:** unitario con `LLMService` + `VaultRetriever` fakeados. Casos: respuesta con citas
válidas, cita alucinada (se filtra), negativa (`answeredFromContext=false` → confidence LOW +
señal), sin chunks (NONE + señal).

**Depende de:** F1-07, F1-08, F1-09 · **Fuera de alcance:** el clasificador (F2-01).

---

## F1-11 · `vault_query_log` + feedback 👍/👎

**Objetivo:** registrar TODA query (no solo los misses) para poder medir de verdad.

**Contexto:** hoy solo se guardan `daily_signals` tipo `RAG_MISS`. `admin.routes` calcula una
"precisión proxy" que el propio código admite como tal.

**Archivos:**
- Modificar: `prisma/schema.prisma` (modelo `VaultQueryLog`, `@@map("vault_query_log")`, sin RLS)
- Crear: migración aditiva
- Modificar: `vault-query-service.ts` (escribir una fila por query, éxito y miss)
- Modificar: `src/infrastructure/http/routes/vault.routes.ts` — `POST /vault/query/:id/feedback`
  con `{ useful: boolean }`
- Test: `tests/http/vault-query-log.test.ts` + integración

**Modelo:**
```prisma
model VaultQueryLog {
  id               String   @id @default(uuid()) @db.Uuid
  question         String
  retrieverVersion String
  llmModel         String
  embeddingModel   String
  chunksReturned   Json     // [{sourceFile, headingPath, rrfScore, rerankScore, distance}]
  confidence       String   // HIGH | LOW | NONE
  answeredFromContext Boolean
  latencyMs        Int
  userId           String?  @db.Uuid
  feedbackUseful   Boolean?
  createdAt        DateTime @default(now())
  @@index([createdAt])
  @@map("vault_query_log")
}
```

**Criterios de aceptación:**
- [ ] `VaultQueryService.query()` escribe exactamente una fila por invocación (éxito, miss, o
      short-circuit sin chunks).
- [ ] La escritura del log **no puede romper** la respuesta al usuario: si falla, se loguea y la
      query devuelve igual (DOM-04, degradación segura).
- [ ] `POST /vault/query/:id/feedback` setea `feedbackUseful`; 404 si el id no existe.
- [ ] `chunksReturned` guarda archivo + headingPath + scores de cada chunk usado.

**Test:** integración — correr una query, verificar la fila; correr una que no encuentra chunks,
verificar la fila con `confidence: NONE`. HTTP — feedback OK y 404.

**Depende de:** F1-06 · **Fuera de alcance:** el panel admin (F1-16).

---

## F1-12 · Set dorado + `npm run eval:rag`

**Objetivo:** un harness que mida el pipeline completo (retriever + rerank + generación) contra
casos de referencia.

**Contexto:** no hay evals. `tests/` usa Vitest. Configs en `vitest.*.config.ts`.

**Archivos:**
- Crear: `tests/rag/golden/*.json` (~60-100 casos, armados con F1-03 + `RAG_MISS` históricos)
- Crear: `tests/rag/eval-runner.ts` + `vitest.eval.config.ts`
- Modificar: `package.json` — `"eval:rag": "vitest run --config vitest.eval.config.ts"`,
  dep `promptfoo` (o runner propio si promptfoo no encaja con Vitest)
- Crear: `tests/rag/fixtures/index-snapshot.sql` (copia congelada de `vault_chunks` para sembrar)
- Test: el runner es el test.

**Formato de caso:**
```json
{
  "id": "itcs-definicion",
  "question": "¿Qué es el ITCS?",
  "expectedFiles": ["conocimiento/catedra/…ITCS….md"],
  "mustAnswer": true,
  "criterion": "menciona que es el índice de … y para qué se usa"
}
```

**Criterios de aceptación:**
- [ ] `npm run eval:rag` corre los N casos contra una DB de test sembrada con el snapshot (NO
      contra prod) y reporta: `recall@5` (archivos esperados entre los top-5), `tasa-negativa-correcta`
      (casos `mustAnswer: false` que se negaron), `tasa-alucinacion-fuente` (citó archivo fuera del
      contexto — objetivo **0**), `citacion-exacta`.
- [ ] El `criterion` se evalúa con un juez Claude (`getLLMService('context')` o similar), no por
      string match.
- [ ] Genera `tests/rag/baseline.json` con las métricas de la corrida actual.
- [ ] Corre en < 5 min localmente.

**Test:** el propio runner; además un caso "trampa" cuya respuesta NO está en la bóveda debe dar
`tasa-negativa-correcta` = 1.

**Depende de:** F1-07, F1-10 · **Fuera de alcance:** el gate de CI (F1-13).

---

## F1-13 · Job de CI de evals con gate

**Objetivo:** que ningún cambio de prompt/umbral/modelo/chunker mergee si baja una métrica.

**Contexto:** `.github/workflows/ci.yml`. Ya existen guardas tipo `check:tests-base`.

**Archivos:**
- Crear: `.github/workflows/eval-rag.yml` (o job dentro de `ci.yml`)
- Crear: `scripts/check-eval-regression.mjs` (compara corrida vs `tests/rag/baseline.json`)
- Modificar: `docs/` — documentar cómo actualizar la baseline a propósito

**Criterios de aceptación:**
- [ ] El job se dispara si el PR toca `src/application/vault-*`, `src/infrastructure/ai/*`,
      `src/application/vault-indexer/markdown-chunker.ts`, `tests/rag/**`, o los prompts.
- [ ] Corre `npm run eval:rag` contra Postgres efímero + el snapshot.
- [ ] **Falla** si baja `recall@5`, sube `tasa-alucinacion-fuente`, o baja
      `tasa-negativa-correcta` respecto de `baseline.json` (con tolerancia configurable).
- [ ] Actualizar la baseline es un cambio explícito en un archivo versionado (no se auto-actualiza).

**Test:** correr el job en un PR de prueba con un cambio que rompe recall a propósito → el job
falla. Revertir → pasa.

**Depende de:** F1-12 · **Fuera de alcance:** —

---

## F1-14 · Loop agéntico: el nightly abre PR a la bóveda

**Objetivo:** que lo aprendido vuelva a `costear-knowledge-base` por un PR revisable, no por un
commit local que se pierde.

**Contexto:** `src/application/nightly-learning/nightly-learning-service.ts` (worker BullMQ,
cron `0 2 * * *`) hoy propone markdown con Groq → `vault_edit_proposals` → `proposal-service.ts`
`approveProposal` hace `appendFile` + `git commit` **sin push**. Disco efímero en Railway.

**Archivos:**
- Modificar: `nightly-learning-service.ts` — deja de escribir; junta señales y **encola/invoca al
  agente de curación**
- Crear: `src/application/nightly-learning/curation-agent.ts` — arma el input y llama al runner
  (Claude Agent SDK headless, `claude -p` con `--allowedTools` y `--permission-mode`, o SDK TS)
- Crear: `src/application/nightly-learning/vault-pr-client.ts` — abre PR en
  `costear-knowledge-base` vía API de GitHub (GitHub App, no PAT — ver F1-15)
- Modificar: `prisma/schema.prisma` — `VaultEditProposal` + `pullRequestUrl`, `pullRequestState`
- **Eliminar:** `proposal-service.ts` `approveProposal` + su ruta en `vault-proposal.routes.ts`
  (el resto de `ProposalService` —list/update/reject— se conserva)
- Test: `tests/application/curation-agent.test.ts`, `tests/application/vault-pr-client.test.ts`

**Criterios de aceptación:**
- [ ] El worker BullMQ ya no llama `fs.appendFile` ni `git commit` en ningún camino.
- [ ] Por cada tanda de `daily_signals` PENDING, el agente produce 0..N ediciones markdown en
      `conocimiento/aprendizaje/` y abre **un** PR con: texto propuesto, IDs de señales,
      `groundedInSignals`, y —si es redacción de IA— `⚠️ requiere verificación de la cátedra` en el
      cuerpo.
- [ ] El agente respeta las `vault_edit_proposals` PENDING (no duplica temas — ya lo hace el prompt
      actual).
- [ ] `vault_edit_proposals` guarda `pullRequestUrl` + estado; el panel puede listarlo.
- [ ] No mergea. RAG-INV-06: el `sourceFile` propuesto se valida que caiga dentro de
      `conocimiento/aprendizaje/`.
- [ ] Los `Reportes_Nocturnos/` dejan de escribirse en un checkout local; el resumen va al cuerpo
      del PR (o a un comentario).

**Test:** unitario con `vault-pr-client` y el runner fakeados. Verificar: una señal basura → 0
ediciones; una `USER_CORRECTION` → 1 edición con `groundedInSignals: true`; un `RAG_MISS` sin
corrección → edición con `requiresVerification` y el aviso en el cuerpo del PR.

**Depende de:** F1-02, F1-09, F1-15 · **Fuera de alcance:** el reindex (F1-15).

---

## F1-15 · `POST /vault/reindex` (HMAC) + Action del repo bóveda + env

**Objetivo:** reindexar cuando algo entra a `main` de la bóveda, sin depender del disco efímero.

**Contexto:** hoy el reindex se dispara desde el panel (`POST /vault/index`) y desde el nightly,
haciendo `git clone`/`git pull` sobre un path que en Railway es efímero.

**Archivos:**
- Modificar: `src/infrastructure/http/routes/vault.routes.ts` — `POST /vault/reindex` con
  verificación de firma HMAC (`X-Vault-Signature`) usando `VAULT_REINDEX_SECRET`
- Modificar: `src/infrastructure/config/env.ts` — validar `VAULT_REINDEX_SECRET`,
  `VAULT_GITHUB_TOKEN` (documentar scope mínimo), `VAULT_PATH`
- Modificar: `vault-indexer-service.ts` — clonar a `VAULT_PATH` (volumen persistente si existe;
  si no, clon limpio) — decisión de §11 del spec
- Crear (en el repo bóveda): `.github/workflows/reindex-on-merge.yml` — al push a `main`, POST
  firmado al endpoint
- Test: `tests/http/vault-reindex.test.ts`

**Criterios de aceptación:**
- [ ] `POST /vault/reindex` sin firma válida → 401, no reindexa.
- [ ] Con firma válida → dispara `VaultIndexerService.indexVault()` y devuelve el `IndexVaultResult`.
- [ ] El lock global de indexación (`indexingInProgress`) se respeta (dos llamadas concurrentes →
      la segunda 409).
- [ ] `env.ts` falla al arrancar si falta `VAULT_REINDEX_SECRET` en producción (no en dev/test).
- [ ] La Action de la bóveda pasa el commit SHA en el body y el endpoint lo loguea.
- [ ] El `POST /vault/index` del panel se conserva (reindex manual de emergencia con `forceClone`).

**Test:** HTTP — firma inválida → 401; válida → 200 con result (indexer fakeado); concurrencia → 409.

**Depende de:** F1-02 · **Fuera de alcance:** —

---

## F1-16 · Panel admin: métricas reales

**Objetivo:** reemplazar la "precisión proxy" por métricas de `vault_query_log`.

**Contexto:** `src/infrastructure/http/routes/admin.routes.ts` `GET /admin/stats` calcula
`misses / procesadas` y lo llama "rough precision". El frontend admin lo consume.

**Archivos:**
- Modificar: `admin.routes.ts` (`GET /admin/stats` → bloque `vault`)
- Modificar: el componente del panel admin que muestra las métricas de la bóveda (repo
  `CosteAR-admin`)
- Test: `tests/http/admin-stats.test.ts`

**Criterios de aceptación:**
- [ ] `vault` en `/admin/stats` incluye: total queries (7d/30d), tasa de negativa, distribución de
      `confidence`, `feedbackUseful` (👍/👎 y % con feedback), top 10 `sourceFile` citados, misses
      recientes agrupados por tema.
- [ ] Se elimina el campo "rough precision" y su comentario.
- [ ] El panel admin muestra los nuevos números; nada de ceros que parezcan datos reales cuando no
      hay tráfico (mostrar "sin datos").

**Test:** HTTP — sembrar `vault_query_log` con filas variadas, asertar el shape y los cálculos.

**Depende de:** F1-11 · **Fuera de alcance:** namespaces en la UI (F2-04).

---

## Orden sugerido de ejecución (dependencias)

```
F1-01 ─┬─ F1-02 ──────────────┬─ F1-14 ── F1-15
       │                      │
F1-03 (paralelo)              │
                              │
F1-04 ── F1-05 ──┐            │
F1-09 ───────────┼─ F1-10 ────┤
F1-06 ── F1-07 ── F1-08 ──────┘
F1-06 ── F1-11 ── F1-16
F1-07 + F1-10 ── F1-12 ── F1-13
```

**Primeros que puede tomar un agente sin esperar nada:** F1-01, F1-03, F1-04, F1-06, F1-09.
