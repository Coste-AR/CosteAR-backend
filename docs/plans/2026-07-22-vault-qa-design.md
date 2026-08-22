# Diseño: consulta y generación de respuestas sobre la bóveda (RAG — read path)

## Contexto

La indexación de la bóveda (`vault_chunks` en pgvector) ya está construida y en uso
(ver `docs/plans/2026-07-21-vault-rag-indexing-design.md`). Este documento cubre la
segunda mitad del RAG: recibir una pregunta de un costista, encontrar el contexto
relevante en la bóveda, y generar una respuesta confiable y citada.

## Decisiones

- **Punto de entrada**: endpoint nuevo e independiente, `POST /vault/ask`, con el
  mismo patrón de auth que `costista-chat`/`advisor` (preHandler `authenticate`).
  No se integra al costista-chat existente (que interpreta acciones, no preguntas
  de conocimiento) ni al advisor (que interpreta números ya calculados).
- **Modelo de generación**: Groq (`GroqService`, ya integrado), no Kimi K3. Para
  redactar una respuesta a partir de contexto ya recuperado no hace falta el
  razonamiento más sofisticado del mercado — Groq es rápido, barato, y sigue
  bien instrucciones de "respondé solo con esto". Revisar esta decisión si en
  el uso real la calidad no alcanza.
- **Estrategia de búsqueda**: híbrida (vectorial + full-text) + reranking, no la
  versión simple. Se justifica porque el dominio (costeo) tiene mucha jerga
  técnica exacta (ITCS, CIP, prorrateo primario/secundario, capacidad ociosa)
  donde la búsqueda semántica sola puede no priorizar el término exacto.
  - **Vectorial**: pgvector, igual que el indexador (`<=>` cosine distance).
  - **Full-text**: nativo de Postgres (`tsvector`/`tsquery`, config `spanish`),
    no se suma infraestructura nueva.
  - **Reranking**: Voyage `rerank-2.5` (mismo proveedor que embeddings, ya
    integrado — se extiende `VoyageService` en vez de sumar un vendor nuevo).
- **Umbral de confianza**: si el mejor score post-rerank es bajo, la respuesta
  es "no tengo información confiable sobre esto en la bóveda" — no se llama al
  generador. El umbral es una constante nombrada, ajustable según uso real (no
  hay data empírica todavía para calibrarlo con precisión).
- **Grounding**: el prompt a Groq incluye únicamente los chunks recuperados
  (con su nota/heading de origen) + la pregunta, con instrucción explícita de
  responder solo con ese contexto, en español argentino, y sin inventar. Las
  citas que se muestran al usuario las arma el propio código (a partir de qué
  chunks se pasaron), no las decide el LLM — evita que la IA invente una fuente.

## Flujo

1. `POST /vault/ask { question }` (autenticado).
2. Embeddear `question` con Voyage (`input_type: 'query'`).
3. Búsqueda vectorial: top 20 chunks por similitud coseno.
4. Búsqueda full-text: top 20 chunks por `ts_rank` contra `plainto_tsquery('spanish', question)`.
5. Unión deduplicada de candidatos (por `id`).
6. Rerank de la unión con Voyage `rerank-2.5` contra `question`.
7. Si el score del mejor resultado < umbral → responder mensaje de "sin
   contexto confiable", sin llamar a Groq.
8. Si no: tomar el top N (ej. 5) tras el rerank, armar el prompt, llamar a
   Groq (`completeJSON`, mismo patrón que `AdvisorService`).
9. Responder `{ answer, citations: [{ sourceFile, sourceTitle, headingPath }], confidence }`.

## Esquema de datos (migración nueva)

Agregar a `VaultChunk` una columna generada para full-text search:

```prisma
model VaultChunk {
  // ...campos existentes...
  contentTsv Unsupported("tsvector")?
}
```

Migración (SQL crudo, igual patrón que la columna `embedding`):
```sql
ALTER TABLE "vault_chunks"
  ADD COLUMN "contentTsv" tsvector GENERATED ALWAYS AS (to_tsvector('spanish', "content")) STORED;

CREATE INDEX "vault_chunks_content_tsv_idx" ON "vault_chunks" USING gin ("contentTsv");
```

(Misma advertencia de drift-detection que ya existe para el índice HNSW: Prisma
no puede representar esta columna/índice completamente, `prisma migrate dev`
puede ofrecer "corregir" el drift — rechazar y usar `prisma migrate status`.)

## Componentes nuevos

- **`src/infrastructure/ai/voyage-service.ts`** (extender): agregar `rerank(query, documents, topK)`.
- **`src/infrastructure/database/vault-search-repository.ts`** (nuevo): `searchByVector`, `searchByKeyword` sobre `vault_chunks`.
- **`src/application/vault-qa/vault-qa-service.ts`** (nuevo): orquesta el flujo completo (pasos 2–9).
- **`src/infrastructure/http/routes/vault.routes.ts`** (nuevo): el endpoint.

## Fuera de alcance

- Pipeline nocturno de correcciones (diseño futuro).
- Sistema de roles/RBAC (diseño futuro).
- UI/frontend para esta función (fuera del repo backend).
