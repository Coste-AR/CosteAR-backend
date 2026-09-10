# Rediseño del subsistema RAG — diseño

- **Fecha:** 2026-09-09
- **Estado:** Borrador para revisión del equipo
- **Alcance acordado:** diseñar el ideal (nivel C), descomponer en fases; la Fase 1 (nivel B)
  cierra la queja "la bóveda no se actualiza" y sube calidad de retrieval/generación.
- **Modo de implementación:** issues del tamaño de una tanda (Codex/Claude), con dependencias
  marcadas, por el flujo issue → PR → `auto-merge`.
- **Documento hermano:** `2026-09-09-rag-actual-vs-planeado.md` (comparación pieza por pieza).

---

## 1. Problema

El RAG de CosteAR (Q&A de la bóveda + consejero + pipeline nocturno de aprendizaje) tiene tres
fallas de fondo:

1. **El loop de escritura está roto.** `ProposalService.approveProposal` hace `git commit` pero
   **nunca `git push`**; en el disco efímero de Railway ese commit se pierde en el próximo deploy.
   Los `Reportes_Nocturnos/` se escriben sin trackear. El repo `costear-knowledge-base` está
   congelado desde el 2026-07-28. Todo lo que el pipeline "aprende" queda en la DB y nunca vuelve
   a la bóveda. **Por eso los compañeros dicen que la bóveda no está actualizada — tienen razón.**
2. **Retrieval débil.** Solo distancia coseno (`<=>`), umbral 0.65 con un reintento a 0.85. Sin
   re-ranking, sin búsqueda híbrida (la columna `contentTsv` existe con índice GIN y **no se
   usa**), sin query expansion. Chunking solo por H2/H3: una nota sin subtítulos es un chunk
   gigante; los H4+ se aplanan. El indexador mete **todo** `.md` (incluidos handoffs de devs,
   mockups y notas de testing de `costeo-procesos/`), que contaminan el retrieval.
3. **No se puede medir.** No hay set de evaluación. La "precisión" del panel admin es un proxy
   (solo cuenta `RAG_MISS`, no todas las queries) — el propio código lo admite. Cualquier cambio
   de prompt, umbral o modelo se hace a ciegas.

Componentes secundarios afectados: la generación corre en Groq con todo el peso anti-alucinación
en el prompt; el índice es plano, sin separar cátedra / corpus del vertical / aprendizaje
aprobado.

## 2. Objetivos

1. **Cerrar el loop**: lo que el pipeline aprende vuelve a `costear-knowledge-base` de forma
   trazable y revisable, con la frescura del índice desacoplada del disco de Railway.
2. **Subir la calidad de retrieval** de forma medible (recall@k, tasa de alucinación de fuente).
3. **Evals que bloquean en CI**: ningún cambio de prompt/umbral/modelo/chunker mergea si baja una
   métrica, con el mismo criterio que `check:tests-base`.
4. **Observabilidad real**: registrar toda query, no solo los misses.
5. **Generación con Claude** (costo razonable aprobado) con citas verificadas, conservando el
   contrato `{answer, citations[], confidence}`.
6. **Namespaces** por tipo de fuente, para pesar/filtrar y para que la UI diga de dónde salió.

### No-objetivos de la Fase 1

- Reescribir el motor de costeo o el flujo del clasificador.
- Cambiar de base vectorial (pgvector se queda — ver §9).
- Unificar `VocabularioTermino` / `IndustryProfile` / bóveda en un store único (Fase 3, con datos).

## 3. Invariantes (el rediseño NO los rompe)

| ID | Invariante | Dónde vive hoy |
|---|---|---|
| RAG-INV-01 | **Cero alucinaciones**: toda afirmación respaldada por un chunk realmente recuperado; las citas se filtran contra el contexto que se le pasó al modelo. | `vault-query-service.ts` L126-133 |
| RAG-INV-02 | **Degradación segura**: sin API keys, sin índice o con el servicio caído → mensaje seguro + señal registrada, nunca un 500 al usuario. | `costista-chat-service.ts` `answerFromVault` |
| RAG-INV-03 | **Trazabilidad**: cada respuesta referencia `sourceFile` (+ `headingPath` cuando aplica); cada chunk guarda el `vaultCommit` de origen. | `vault_chunks.vaultCommit` |
| RAG-INV-04 | **La bóveda no se puede vaciar por accidente**: un checkout parcial/vacío es error de config, no "se borró el contenido". | `vault-indexer-service.ts` L134-160 |
| RAG-INV-05 | **Si el clasificador llega a consumir RAG** (Fase 2, a evaluar), es solo en Layer 5 como contexto adicional; nunca cambia una decisión determinista ni saltea revisión humana (DOM-04, "cero errores silenciosos"). | n/a (nuevo) |
| RAG-INV-06 | **`sourceFile` generado por IA nunca es una ruta de confianza**: se valida que resuelva dentro de la bóveda antes de escribir. | `proposal-service.ts` L34 |

## 4. Arquitectura objetivo (nivel C)

```
                    ┌─────────────────────────────────────────────┐
                    │        costear-knowledge-base (repo)         │
                    │  conocimiento/   (indexable)                 │
                    │    catedra/       clases 1..N                │
                    │    procesos/      corpus P1..P4              │
                    │    aprendizaje/   ediciones aprobadas        │
                    │  interno/        (NO indexable: specs, mockups, testing) │
                    │  .vaultignore                                │
                    └───────────────┬─────────────────────────────┘
                                    │ merge a main
                                    ▼
              GitHub Action del repo bóveda → POST /vault/reindex (HMAC)
                                    │
                                    ▼
   ┌────────────────────────── CosteAR-backend ──────────────────────────┐
   │  Ingesta            Índice / Retrieval           Generación         │
   │  ┌───────────┐      ┌──────────────────┐        ┌────────────────┐  │
   │  │ chunker   │      │ vault_chunks     │        │ LLMService     │  │
   │  │ recursivo │─────▶│  embedding (vec) │        │  ├ Anthropic   │  │
   │  │ +contexto │      │  contentTsv (fts)│        │  └ Groq (whisper│  │
   │  │ (Haiku)   │      │  sourceType (ns) │        │     + fallback) │  │
   │  └───────────┘      └────────┬─────────┘        └───────┬────────┘  │
   │                              │ híbrido (RRF)            │           │
   │                              ▼                          │           │
   │                     rerank (voyage-rerank-2.5)          │           │
   │                              │ top-5                    │           │
   │                              ▼                          ▼           │
   │                   VaultRetriever ───────────▶ VaultQueryService     │
   │                                                  │ answer+citas     │
   │  vault_query_log  ◀───────────────────────────── │ (toda query)     │
   │  daily_signals    ◀───────────────────────────── │ (RAG_MISS, etc)  │
   └──────────────────────────────┬─────────────────────────────────────┘
                                  │ cron
                                  ▼
                   Agente de curación (Claude Agent SDK, headless)
                   lee daily_signals → investiga → abre PR a la bóveda
                                  │
                                  ▼
                        review humano (etiqueta auto-merge)
```

## 5. Diseño por componente

### 5.1 Contrato de la bóveda: qué es conocimiento y qué no

**Problema:** el indexador mete todo `.md`. `costeo-procesos/spec/HANDOFF-DEVS…`,
`mockups/*.html`, `testing/…` no son metodología de costeo y contaminan el retrieval.

**Diseño:**
- Reestructurar `costear-knowledge-base`:
  - `conocimiento/catedra/` — las clases (hoy `001.1 - Clases (Mirta)/`)
  - `conocimiento/procesos/` — el corpus P1–P4 de costeo por procesos
  - `conocimiento/aprendizaje/` — destino de las ediciones que aprueba el pipeline
  - `interno/` — specs, mockups, handoffs, testing (NO se indexa)
- El indexador respeta:
  1. Un `.vaultignore` en la raíz (globs, sintaxis gitignore), **y**
  2. Frontmatter `index: false` en cualquier nota puntual.
- `IGNORED_DIRS` deja de ser una constante hardcodeada y pasa a leerse de `.vaultignore`.
- **Migración de contenido**: un issue de "auditoría de contenido" mueve los archivos actuales a
  la estructura nueva **en un PR al repo bóveda**, sin perder historia (`git mv`).

**Verificación con la cátedra (issue aparte, con checklist):** confirmar si hay clases más allá de
las cargadas, apuntes o correcciones de la cátedra sin subir, y si el corpus de procesos está
completo. Es una pregunta al equipo/cátedra, no una suposición del plan.

### 5.2 Chunking + Contextual Retrieval

**Diseño:**
- Chunker recursivo: parte por H2/H3 → si el bloque supera ~800 tokens, por párrafos → si un
  párrafo supera el techo, por oraciones. Solape de ~1 párrafo entre chunks contiguos.
- H4+ dejan de aplanarse: se conservan como marcadores dentro del `headingPath`.
- **Contextual Retrieval** (técnica de Anthropic, ver referencias): antes de embeber, se antepone
  a cada chunk un contexto de 1–2 frases —de qué trata el documento y dónde encaja este
  fragmento— generado **una sola vez con Claude Haiku** por chunk nuevo/cambiado. Se guarda en una
  columna `contextualPrefix` y se embebe `contextualPrefix + "\n\n" + content`.
  - Costo controlado con **prompt caching** (el documento entero se cachea, cada chunk varía) y
    **Batch API** (–50%). Con ~200–400 chunks y reindex incremental por hash, es de centavos.
- El `contentHash` pasa a incluir el `contextualPrefix` para no re-embeber sin cambios.

### 5.3 Índice y retrieval (pgvector se queda)

**Cambios de schema en `vault_chunks`** (migración aditiva, DOM-06):
- `sourceType` — enum `CATEDRA | PROCESOS | APRENDIZAJE` (namespace).
- `contextualPrefix` — texto del §5.2.
- (ya existen: `embedding vector(1024)`, `contentTsv tsvector` + índice GIN, `vaultCommit`.)

**`VaultRetriever` (módulo nuevo, reemplaza a `searchChunks` como punto de entrada):**
1. **Recuperación híbrida** de ~20 candidatos:
   - rama vector: `embedding <=> $q` (HNSW ya existe)
   - rama full-text: `contentTsv @@ websearch_to_tsquery('spanish', $q)`, ranking `ts_rank_cd`
   - fusión con **RRF** (Reciprocal Rank Fusion, `k=60`): `score = Σ 1/(k + rank_i)`
2. **Re-ranking**: `voyage rerank-2.5` sobre los ~20 → top-5. (Sube NDCG@10 de ~81.6 a ~84.4 con
   50 candidatos según Voyage; probamos 20 vs 50 en los evals.)
3. **Filtro por namespace** opcional (`sourceType IN (...)`) y por `maxDistance` recalibrado
   contra los evals, no a ojo. El reintento "widened → confidence LOW" se conserva pero el
   umbral sale de los evals.

**`VaultChunkRepository`** conserva las operaciones de escritura (upsert/delete/orphan) tal cual;
solo cambia el camino de lectura.

### 5.4 Generación

**Diseño:**
- **`LLMService` (capa nueva)** con las tres operaciones que hoy expone `GroqService`:
  `completeJSON<T>(system, user, opts)`, `classifyDocument(input)`, `transcribeAudio(...)`.
- **Implementación recomendada: Vercel AI SDK** (`ai` + `@ai-sdk/anthropic` + provider de Groq) en
  vez de un wrapper propio sobre cada SDK — ver `herramientas-a-evaluar.md` §2. Da `generateObject`
  con schema Zod (que ya usan), prompt caching de Anthropic por `providerOptions`, y
  `experimental_telemetry` → OpenTelemetry sin código extra. `transcribeAudio` (Whisper) se queda
  con el cliente Groq directo.
- Selección de modelo por caso de uso vía `getEnv()`:
  - `vault-query` (Q&A de la bóveda) → **Claude Sonnet** (síntesis con citas).
  - `advisor-service` (consejero de números) → **Claude Sonnet**.
  - contextual-retrieval batch → **Claude Haiku** (barato, alto volumen).
  - `classifier` Layer 5 → se mantiene en Groq por ahora (latencia); Fase 2 evalúa Claude Haiku.
  - `transcribeAudio` → se queda en Groq (Whisper).
- **Prompt caching**: el system prompt anti-alucinación + las instrucciones se marcan como
  `cache_control`; los chunks recuperados van sin cachear (son lo que varía). ~60–80 % menos
  tokens de entrada facturados en endpoints con tráfico.
- El contrato de respuesta **no cambia**: `{ answer, citations[], confidence: HIGH|LOW|NONE }`.
  Con Claude las citas salen más confiables y el prompt "cero alucinaciones" se puede acortar
  (pero RAG-INV-01 se mantiene: filtrado de citas contra contexto real).
- **Estimación de costo** (se completa en el spec final con volúmenes de `daily_signals` +
  `vault_query_log` una vez que exista): tráfico esperado bajo (chat de costistas + Q&A admin),
  con caching y batch el orden de magnitud es unidades de dólar/mes.

### 5.5 Loop de aprendizaje agéntico (el corazón del arreglo)

**Hoy:** `NightlyLearningService` (worker BullMQ, cron `0 2 * * *`) junta `daily_signals` → Groq
propone markdown → `vault_edit_proposals` → `approveProposal` hace `appendFile` + `git commit`
(sin push) → reindex. **El commit se pierde.**

**Diseño:**
- El worker BullMQ **deja de proponer y escribir**. Su única tarea pasa a ser: juntar las
  `daily_signals` PENDING del período y **encolar una corrida de un agente headless**.
- **Agente de curación** (Claude Agent SDK, `claude -p` / SDK TS, corriendo como GitHub Action
  programada del repo `costear-knowledge-base` **o** como job disparado por el worker — decisión
  abierta, ver §11):
  - Entrada: el lote de señales (RAG_MISS, USER_CORRECTION, ASSISTANT_MISS, IMPROVEMENT_REPORT).
  - Por cada tema: recupera contexto de la bóveda + corpus, redacta la edición markdown en
    `conocimiento/aprendizaje/`, y decide `groundedInSignals` (transcripción de algo que un
    humano escribió) vs redacción propia de la IA.
  - **Abre UN PR** a `costear-knowledge-base` con: el texto propuesto, las señales que lo
    originaron (IDs), y —si `groundedInSignals=false`— una nota `⚠️ requiere verificación de la
    cátedra` bien visible en el cuerpo del PR.
  - No mergea. Los humanos revisan con el flujo que ya tienen: la etiqueta `auto-merge` es el
    juicio humano que reemplaza al review.
- **`vault_edit_proposals` se conserva** como registro (estado del tema + link al PR), pero
  `approveProposal` **se elimina** — ya no hay escritura de archivos desde el backend.
- **Reindex por merge**: cuando el PR entra a `main` de la bóveda, una GitHub Action del repo
  bóveda llama `POST /vault/reindex` (firma HMAC con un secreto nuevo `VAULT_REINDEX_SECRET`).
  El endpoint clona/actualiza a un directorio persistente si existe, o clona limpio, y reindexa.
  **Se elimina el `git pull` sobre disco efímero como camino normal.**
- `VAULT_GITHUB_TOKEN` pasa a validarse en `env.ts` (hoy es uso ad-hoc) y se documenta el scope
  mínimo (contents:write + pull_requests:write sobre `costear-knowledge-base`, idealmente un
  GitHub App, no un PAT).

### 5.6 Observabilidad

**Diseño:**
- Tabla nueva `vault_query_log` (sin RLS, es operativa; mismo criterio que `vault_chunks`):
  `id, question, embeddingModel, retrieverVersion, chunksReturned (jsonb: [{sourceFile, headingPath, distance, rerankScore}]), confidence, answeredFromContext, llmModel, latencyMs, userId?, feedbackUseful?, createdAt`.
- `VaultQueryService` escribe una fila por query (éxito y miss). El `feedbackUseful` se completa
  con un endpoint `POST /vault/query/:id/feedback` (👍/👎) que la UI ya puede llamar.
- El panel admin deja de mostrar una "precisión proxy" y muestra métricas reales:
  recall observado (cuando hay feedback), tasa de negativa, distribución de confianza, top
  `sourceFile` citados, misses recientes agrupados por tema.

### 5.7 Evals (bloquean en CI)

**Diseño:**
- **Set dorado** en `tests/rag/golden/` — ~60–100 casos `{ pregunta, archivosEsperados[],
  respuestaEsperada|criterio, debeNegarse? }`, construido con la cátedra a partir de las clases y
  de los `RAG_MISS` históricos. Versionado en el repo.
- **Harness** `npm run eval:rag` que corre el pipeline completo (retriever + rerank + generación)
  contra el set y reporta:
  - `recall@5` de archivos correctos
  - `tasa-negativa-correcta` (cuando `debeNegarse`, ¿se negó?)
  - `tasa-alucinacion-fuente` (¿citó un archivo que no estaba en el contexto?) — debe ser 0
  - `citacion-exacta` (¿los archivos citados son los esperados?)
- Framework: **Promptfoo** para el runner declarativo + gate de release, con métricas estilo
  **RAGAS** (faithfulness, context recall/precision) calculadas con un juez Claude. Se corre
  contra una DB de test sembrada con una copia congelada del índice (fixture), no contra prod.
- **Job de CI en `CosteAR-backend`**: se dispara si el PR toca `src/application/vault-*`,
  `src/infrastructure/ai/*`, los prompts, el chunker o el set dorado. Falla si baja `recall@5`,
  sube `tasa-alucinacion-fuente`, o baja `tasa-negativa-correcta` respecto de la baseline
  guardada. Mismo espíritu que `check:tests-base` / `check-feature-tests`.
- **Opcional (Fase 2): Langfuse self-hosted** (MIT, Docker Compose) para trazas de producción +
  correr los evals contra tráfico real. Se evalúa según volumen.

### 5.8 Clasificador ↔ RAG — evaluación, no compromiso (Fase 2)

Hoy el clasificador **no** consulta la bóveda (usa `IndustryProfile`, `VocabularioTermino`,
`correction-memory.ts` por solapamiento de señales, `SupplierFingerprint`).

**Spike acotado (issue propio):** que Layer 5 (desempate por IA) reciba, como contexto adicional,
los 2–3 chunks de metodología más relevantes al tipo en duda (ej. "cuándo un flete es MP vs gasto
de comercialización"). Medir con casos reales de `ClassificationAudit`:
- ¿Sube la tasa de acierto de Layer 5 vs el costista?
- ¿La latencia se mantiene bajo un techo (p95 objetivo a definir)?
- ¿Aparece algún caso donde el contexto de la bóveda empeora la decisión?

Si no mueve la aguja, se descarta y queda documentado en un ADR. **RAG-INV-05 aplica**: aunque
mejore, Layer 5 sigue pasando por revisión humana ante conflicto.

### 5.9 MCP server de la bóveda (Fase 2)

`costear-vault-mcp` — MCP server chico que expone `vault.search(query, namespace?)` y
`vault.get(sourceFile)`, reusando `VaultRetriever` + `VaultChunkRepository`. Permite al equipo
consultar la metodología desde Claude Code / Claude Desktop sin abrir el panel. Se despliega junto
al backend (mismo proceso o sidecar). Auth por token de servicio.

## 6. Cambios de modelo de datos (todos aditivos — DOM-06)

| Tabla | Cambio |
|---|---|
| `vault_chunks` | + `sourceType` (enum), + `contextualPrefix` (text, nullable) |
| `vault_query_log` | **nueva** (ver §5.6) |
| `vault_edit_proposals` | + `pullRequestUrl` (text, nullable), + `pullRequestState` (enum) |
| — | `approveProposal` y su ruta se **eliminan** (no es cambio de schema) |

## 7. Fases y descomposición en issues

### Fase 1 — cierra la queja + salto de calidad (nivel B)

| # | Issue | Depende de |
|---|---|---|
| F1-01 | Contrato de bóveda: `.vaultignore` + frontmatter `index:false`; indexador los respeta | — |
| F1-02 | Reestructura del repo `costear-knowledge-base` a `conocimiento/`+`interno/` (PR al repo bóveda, `git mv`) | F1-01 |
| F1-03 | Auditoría de contenido con la cátedra (checklist, no código) | — |
| F1-04 | Chunker recursivo + solape + H4 en `headingPath` | — |
| F1-05 | Contextual Retrieval: `contextualPrefix`, generación con Haiku + batch + caching, `contentHash` incluye el prefijo | F1-04 |
| F1-06 | Schema: `vault_chunks.sourceType` + `contextualPrefix` (migración aditiva) | — |
| F1-07 | `VaultRetriever`: híbrido vector+FTS con RRF | F1-06 |
| F1-08 | Re-ranking `voyage rerank-2.5` en `VaultRetriever` | F1-07 |
| F1-09 | Capa `LLMService` provider-agnóstica. **Recomendación (ver `herramientas-a-evaluar.md` §2): usar el Vercel AI SDK (`ai` + `@ai-sdk/anthropic` + provider Groq)** en vez de escribir el wrapper a mano — da structured output con Zod, prompt caching por `providerOptions` y telemetría OpenTelemetry gratis. `GroqLLMService` queda como renombre del actual para Whisper/fallback. | — |
| F1-10 | `vault-query` y `advisor` → Claude con prompt caching; contrato de respuesta intacto | F1-09 |
| F1-11 | `vault_query_log` + escritura por query + endpoint de feedback 👍/👎 | F1-06 |
| F1-12 | Set dorado `tests/rag/golden/` + `npm run eval:rag` (Promptfoo + juez Claude) | F1-07, F1-10 |
| F1-13 | Job de CI de evals con baseline y gate | F1-12 |
| F1-14 | Loop agéntico: worker solo encola; agente de curación abre PR a la bóveda; `approveProposal` eliminado; `vault_edit_proposals` + estado de PR | F1-02, F1-09 |
| F1-15 | `POST /vault/reindex` (HMAC) + GitHub Action del repo bóveda que lo llama al merge; `VAULT_*` validados en `env.ts` | F1-02 |
| F1-16 | Panel admin: métricas reales desde `vault_query_log` (reemplaza la precisión proxy) | F1-11 |

### Fase 2 — con datos de los evals y de `vault_query_log`

| # | Issue |
|---|---|
| F2-01 | Spike clasificador ↔ RAG en Layer 5 (medir contra `ClassificationAudit`) → ADR |
| F2-02 | `costear-vault-mcp` (MCP server) |
| F2-03 | Recalibración de umbrales/`k` de rerank con datos reales |
| F2-04 | Namespaces en la UI del panel (filtro por fuente, "de dónde salió") |
| F2-05 | (Opcional) Langfuse self-hosted para trazas de producción |

### Fase 3 — según evidencia

| # | Issue |
|---|---|
| F3-01 | Unificar `VocabularioTermino` + `IndustryProfile` + bóveda en un store con namespaces (si el spike F2-01 lo justifica) |
| F3-02 | El consejero de números (`advisor-service`) cita metodología de la cátedra |
| F3-03 | Evaluar `voyage-3-large` / Cohere `embed-v4` / re-embeber, si los evals muestran techo del modelo actual |

## 8. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Reestructurar el repo bóveda rompe el indexador mientras se migra | F1-01 y F1-02 en el mismo PR coordinado; el indexador tolera ambas estructuras durante una ventana |
| Claude más lento que Groq en el chat del costista | `vault-query` no está en el camino crítico del chat (es una derivación explícita); medir p95 en F1-10; caching baja latencia de entrada |
| Costo de Claude se dispara | Prompt caching + Batch para contextual retrieval; `vault_query_log` da el número real en 2 semanas; gate de costo en el panel |
| El agente de curación propone basura y satura de PRs | Igual que hoy: el humano decide con la etiqueta; el agente agrupa por tema (ya lo hace el prompt actual) y respeta las propuestas pendientes |
| GitHub App / token con permisos de más | GitHub App con permisos mínimos sobre un solo repo; documentado en `env.ts` y en el runbook |
| Los evals se vuelven un teatro (pasan pero la calidad real baja) | `vault_query_log` + feedback 👍/👎 son el control cruzado contra tráfico real; el set dorado se amplía con misses nuevos |

## 9. Alternativas consideradas y descartadas

| Alternativa | Por qué no (ahora) |
|---|---|
| Cambiar pgvector por Qdrant/Pinecone | La regla de 2026: Postgres-resident sirve hasta ~decenas de millones de vectores; la bóveda tiene cientos de chunks. Sumar infra no compra nada. Revisar solo si el corpus crece 100×. |
| `pgvectorscale` / `VectorChord` | Mejoran inserción/escala; a este tamaño no cambian nada. Anotado por si el corpus crece. |
| Mantener Groq para todo y solo mejorar retrieval (Approach A) | Deja el prompt anti-alucinación cargando todo el peso; el usuario aprobó "lo mejor con costo razonable". |
| Loop con `git push` directo desde el backend | Sin segunda mirada; el admin del panel sería el único freno. El PR reusa el mecanismo de review que el equipo ya confía. **(decisión tomada: PR, no push)** |
| Rediseño total unificando clasificador + RAG desde el día 1 (Approach C completo) | Toca el clasificador (production-critical); mejor landear B, medir con los evals nuevos, y que la Fase 3 se decida con datos. |

## 10. Cómo se verifica que sigue vigente

- `npm run eval:rag` en verde contra la baseline en cada PR que toca el subsistema.
- `vault_query_log` con filas nuevas cada día (el logging no se rompió).
- El repo `costear-knowledge-base` recibe PRs del agente y su `main` avanza (el loop cerró).
- El panel admin muestra métricas reales, no el proxy.

## 11. Preguntas abiertas (no bloquean el diseño; se cierran antes de F1-14/F1-15)

1. **Runner del agente de curación**: ¿GitHub Action programada en `costear-knowledge-base`, o job
   headless disparado por el worker del backend? (Action = más aislado y reusa el CI; worker =
   menos infra nueva.)
2. **GitHub App vs PAT** para que el agente abra PRs en la bóveda.
3. **Directorio persistente para el checkout de la bóveda** en Railway (volumen) vs clonar limpio
   en cada `POST /vault/reindex` (más lento, cero estado).
4. Número exacto de candidatos al reranker (20 vs 50) — lo deciden los evals en F1-12.

## Referencias

- Contextual Retrieval — Anthropic Cookbook:
  https://platform.claude.com/cookbook/capabilities-contextual-embeddings-guide
- Prompt caching para RAG (cachear instrucciones, no los chunks): https://www.anthropic.com/news/prompt-caching
- Claude Agent SDK / headless / `claude-code-action@v1`: https://docs.anthropic.com/en/docs/claude-code/sdk
- Voyage `rerank-2.5` (NDCG@10 81.6→84.4 con 50 candidatos): https://blog.voyageai.com/
- Promptfoo (release gates declarativos) vs RAGAS (métricas RAG): https://promptfoo.dev/ · https://docs.ragas.io/
- Langfuse self-hosted (MIT, ClickHouse): https://langfuse.com/self-hosting
- Postgres vector 2026 (pgvector sigue siendo el default hasta ~10^7 vectores): https://www.web3aiblog.com/blog/postgres-vector-search-compared-pgvector-pgvectorscale-paradedb-lantern-2026
