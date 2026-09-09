# RAG — actual vs. rediseño planeado

- **Fecha:** 2026-09-09
- **Acompaña a:** `2026-09-09-rediseno-rag-design.md`
- **Para qué:** decidir en equipo el corte entre fases. Cada fila: qué hay hoy, qué propone el
  rediseño, por qué, qué cuesta el cambio y qué se paga si no se hace.

## Resumen ejecutivo

| Dimensión | Hoy | Rediseño | Fase |
|---|---|---|---|
| Loop de aprendizaje | **Roto** (commit sin push, disco efímero) | PR a la bóveda + reindex por merge | 1 |
| Retrieval | Solo vector, umbral fijo | Híbrido (vector+FTS) + RRF + rerank | 1 |
| Chunking | H2/H3, chunk gigante si no hay subtítulos | Recursivo + solape + contexto por chunk | 1 |
| Qué se indexa | Todo `.md` (incluye specs/mockups de devs) | Solo `conocimiento/`, vía `.vaultignore` | 1 |
| Generación | Groq, prompt anti-alucinación pesado | Claude Sonnet + prompt caching | 1 |
| Medición | Proxy (solo cuenta `RAG_MISS`) | `vault_query_log` + set dorado + gate en CI | 1 |
| Namespaces | Índice plano | `sourceType`: cátedra / procesos / aprendizaje | 1 |
| Clasificador + RAG | Separados | Spike: Layer 5 consulta metodología | 2 |
| Acceso del equipo | Solo panel admin | MCP server | 2 |
| Store de conocimiento | 3 tablas separadas (`vault_chunks`, `VocabularioTermino`, `IndustryProfile`) | Evaluar unificación con namespaces | 3 |

## Detalle por componente

### 1. Loop de escritura (la queja de los compañeros)

- **Hoy:** `ProposalService.approveProposal` → `fs.appendFile` al `.md` → `git add` + `git commit`
  → **sin `git push`**. En Railway el disco es efímero: el commit se pierde en el próximo deploy.
  Los `Reportes_Nocturnos/` se escriben sin trackear. `costear-knowledge-base` congelado desde
  2026-07-28. Un `Auto-mejora: TEST…` llegó una vez al repo y fue revertido.
- **Rediseño:** el agente de curación abre **un PR** a `costear-knowledge-base` por cada tanda de
  señales. Humanos revisan con el flujo `auto-merge` existente. Al merge, una Action del repo
  bóveda llama `POST /vault/reindex` (HMAC). Cero escritura de archivos desde el backend.
- **Por qué:** es el bug que hace que "la bóveda no se actualice". El PR reusa el mecanismo de
  review en el que el equipo ya confía y deja historia de git auditable.
- **Costo del cambio:** medio-alto. GitHub App con permisos mínimos, un endpoint nuevo, mover el
  `NightlyLearningService` de "escribe" a "encola agente". Issue F1-14/F1-15.
- **Si no se hace:** el pipeline sigue "aprendiendo" en la DB y tirando todo a la basura en cada
  deploy. El RAG responde con conocimiento de julio para siempre.

### 2. Retrieval

- **Hoy:** `vault-chunk-repository.searchChunks` — solo `embedding <=> $q` (coseno), `LIMIT 5`,
  `maxDistance` 0.65 → reintento 0.85 marcando `confidence: LOW`. La columna `contentTsv`
  (tsvector español + índice GIN) **existe y no se usa**.
- **Rediseño:** `VaultRetriever` — híbrido (rama vector + rama full-text `websearch_to_tsquery`)
  fusionado con RRF, ~20 candidatos → `voyage rerank-2.5` → top-5. Umbrales calibrados con evals.
- **Por qué:** el vector solo falla con siglas y términos exactos de la cátedra (el código ya lo
  admite con el reintento). El FTS los captura; el rerank sube NDCG@10 ~1.5–3 pts. La infra de
  FTS ya está pagada.
- **Costo del cambio:** medio. Un módulo nuevo, `rerank-2.5` es una llamada más a Voyage
  (centavos). Issues F1-07, F1-08.
- **Si no se hace:** preguntas legítimas ("¿qué es el ITCS?") siguen cayendo en `RAG_MISS` o en
  confianza LOW aunque la respuesta esté en la bóveda.

### 3. Chunking

- **Hoy:** `markdown-chunker` parte por H2/H3. Nota sin subtítulos → 1 chunk (puede ser toda la
  nota). H4+ se aplanan como texto plano de la sección. Sin solape.
- **Rediseño:** recursivo (H2/H3 → párrafos → oraciones) con techo ~800 tokens y solape;
  H4+ preservados en `headingPath`. Contextual Retrieval: prefijo de 1–2 frases por chunk
  (Claude Haiku, batch + caching) embebido junto al contenido.
- **Por qué:** un chunk gigante diluye el embedding y arrastra ruido; sin contexto, un fragmento
  ("...se distribuye según horas máquina...") no se recupera para "prorrateo de CIP". Contextual
  Retrieval es la mejora de retrieval con mejor relación resultado/esfuerzo hoy.
- **Costo del cambio:** medio. Reescribir el chunker (tiene tests), + generación de prefijos
  (centavos con batch). Issues F1-04, F1-05.
- **Si no se hace:** techo de recall que ningún reranker ni modelo tapa.

### 4. Qué se indexa

- **Hoy:** `listMarkdownFiles` indexa todo `.md` salvo el README raíz. Entran
  `costeo-procesos/spec/HANDOFF-DEVS…`, `mockups/*.html` (bueno, HTML no, pero los `.md` de
  spec/testing sí), notas de testing con fechas.
- **Rediseño:** `.vaultignore` (globs) + frontmatter `index: false`. Repo reestructurado en
  `conocimiento/` (indexable) e `interno/` (no).
- **Por qué:** un handoff para devs no es metodología de costeo; recuperarlo para una pregunta de
  un costista es ruido puro.
- **Costo del cambio:** bajo-medio. `.vaultignore` es simple; mover archivos en el repo bóveda con
  `git mv` en un PR coordinado. Issues F1-01, F1-02.
- **Si no se hace:** el corpus efectivo queda contaminado con documentación de proyecto.

### 5. Generación

- **Hoy:** `VaultQueryService` y `AdvisorService` usan `GroqService.completeJSON`. System prompt
  con 5 reglas de "cero alucinaciones" cargando todo el peso. Sin caching.
- **Rediseño:** interfaz `LLMService`; `AnthropicLLMService` con `@anthropic-ai/sdk`; Q&A y
  consejero → Claude Sonnet; contextual-retrieval → Haiku. Prompt caching en instrucciones.
  Contrato `{answer, citations, confidence}` intacto; filtrado de citas (RAG-INV-01) intacto.
- **Por qué:** mejor síntesis con citas, menos dependencia de que el prompt "adivine" bien; el
  usuario aprobó costo razonable. Caching baja 60–80 % los tokens de entrada facturados.
- **Costo del cambio:** medio. SDK nuevo, abstracción, migrar 2 servicios. Groq queda para
  Whisper y como fallback. Issues F1-09, F1-10.
- **Si no se hace:** la calidad de la respuesta queda atada al modelo más débil del stack y a un
  prompt frágil.

### 6. Medición y observabilidad

- **Hoy:** `admin.routes` calcula "precisión" como `1 - (RAG_MISS / procesadas)`. El propio código
  dice que es un proxy porque solo se guardan los misses. No hay evals.
- **Rediseño:** `vault_query_log` (una fila por query, con chunks + distancias + confianza +
  feedback 👍/👎), set dorado `tests/rag/golden/`, `npm run eval:rag` (Promptfoo + juez Claude),
  gate de CI que bloquea si baja recall / sube alucinación.
- **Por qué:** hoy no se puede decir si un cambio mejora o empeora el RAG. Es el equivalente al
  "el CI mide qué tests corren, no cuántos" que ya aplicaron al resto.
- **Costo del cambio:** medio. Tabla nueva, harness, set dorado (trabajo con la cátedra), job de
  CI. Issues F1-11, F1-12, F1-13, F1-16.
- **Si no se hace:** cada tuneo de umbral/prompt/modelo es a ciegas y las regresiones se descubren
  por queja de un usuario.

### 7. Namespaces

- **Hoy:** `vault_chunks` sin discriminar origen. Todo pesa igual.
- **Rediseño:** `sourceType` (`CATEDRA | PROCESOS | APRENDIZAJE`). El retriever puede filtrar y la
  UI dice de dónde salió; el aprendizaje aprobado puede pesar distinto que la cátedra.
- **Por qué:** una edición autogenerada aprobada no debería competir de igual a igual con una
  clase de la cátedra; y el costista merece saber si la respuesta viene de la cátedra o de una
  mejora reciente.
- **Costo del cambio:** bajo (columna + backfill por carpeta). Issue F1-06.
- **Si no se hace:** no se puede razonar sobre la procedencia ni priorizar fuentes.

### 8. Clasificador ↔ RAG (Fase 2, spike)

- **Hoy:** el clasificador no toca la bóveda. Usa `IndustryProfile`, `VocabularioTermino`,
  `correction-memory` (few-shot por solapamiento de señales, sin embeddings), `SupplierFingerprint`.
- **Rediseño:** medir si darle a Layer 5 los 2–3 chunks de metodología relevantes mejora el
  acierto vs el costista, sin pasar un techo de latencia. Si no, se descarta con ADR.
- **Por qué:** hay conocimiento de la cátedra ("cuándo un flete es MP") que hoy vive solo en la
  bóveda y el clasificador re-deriva con keywords.
- **Costo del cambio:** spike acotado; la adopción real sería otro issue.
- **Si no se hace:** dos sistemas mantienen su propia noción de "qué dice la cátedra".

### 9. Acceso del equipo (Fase 2)

- **Hoy:** solo el panel admin (`/vault/query`, requiere rol ADMIN).
- **Rediseño:** `costear-vault-mcp` — consultar la metodología desde Claude Code / Desktop.
- **Por qué:** el equipo (y los agentes) razonan mejor sobre costeo si pueden preguntarle a la
  bóveda sin cambiar de herramienta.
- **Costo del cambio:** bajo-medio (server chico que reusa `VaultRetriever`). Issue F2-02.

### 10. Store de conocimiento (Fase 3)

- **Hoy:** `vault_chunks` (RAG) + `VocabularioTermino` (clasificador) + `IndustryProfile`
  (clasificador) — tres modelos, tres flujos de carga.
- **Rediseño:** evaluar unificar en un store con namespaces y un solo camino de curación.
- **Por qué:** hoy agregar un término de rubro y agregar una nota de metodología son procesos
  distintos que deberían converger.
- **Costo del cambio:** alto; solo si los evals + el spike F2-01 lo justifican.

## Qué se puede cortar sin romper el resto

- **Fase 1 sin F1-05 (contextual retrieval):** funciona, pero deja recall sobre la mesa. El resto
  (loop, híbrido, rerank, Claude, evals) no depende de él.
- **Fase 1 sin F1-10 (Claude):** el retriever nuevo + evals + loop ya arreglan lo más grave;
  Groq sigue generando. Se puede sumar Claude después con los evals midiendo la diferencia.
- **Fase 1 sin F1-14/15 (loop agéntico):** NO recomendado — es la queja original. Si hay que
  cortar algo del loop, cortar el agente Claude y hacer que el nightly abra un PR "tonto" con el
  markdown que ya genera hoy (Groq), pero **con push/PR de verdad**.

## Costo estimado (se afina con datos reales en 2 semanas de `vault_query_log`)

| Ítem | Estimación inicial |
|---|---|
| Claude Sonnet en Q&A + consejero | bajo — tráfico de unidades de consultas/día, con caching ~–70 % entrada |
| Claude Haiku contextual retrieval | centavos/mes — batch (–50 %) + solo chunks nuevos/cambiados |
| Voyage `rerank-2.5` | centavos/mes — ~20 docs por query |
| Voyage embeddings (sin cambio de modelo) | igual que hoy |
| Langfuse self-hosted (Fase 2, opcional) | infra: un contenedor + ClickHouse; $0 de licencia |
| **Total incremental Fase 1** | **orden de magnitud: unidades de USD/mes** |
