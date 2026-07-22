# Diseño: indexación de la bóveda de costeo (RAG)

## Contexto

CosteAR va a incorporar un sistema de IA que responda preguntas de costeo basándose
**únicamente** en la bóveda de conocimiento del equipo (`costear-knowledge-base`,
clases de profesores de costos en Obsidian/Markdown), no en el conocimiento general
del modelo. Esto es clave para la confiabilidad del producto: cada respuesta debe
poder trazarse a una nota concreta de la bóveda.

Este documento cubre la primera pieza: **indexar la bóveda** (chunking + embeddings +
almacenamiento vectorial). La búsqueda/generación (RAG query-time) y el pipeline
nocturno de aprendizaje por correcciones son diseños posteriores, fuera de este
alcance.

## Decisiones ya tomadas (contexto de las conversaciones previas)

- **Contenido fuente**: repo separado `Coste-AR/costear-knowledge-base`, clonado
  localmente, notas `.md` de metodología de costeo (sin datos personales).
- **Proveedor de embeddings**: Voyage AI (mejor calidad multilingüe para RAG;
  Groq no ofrece embeddings).
- **Vector store**: pgvector sobre el Postgres existente (Railway), vía Prisma +
  raw SQL para la parte vectorial — no se suma una DB vectorial nueva.
- **Chunking**: structure-aware (por nota / headers), no por tamaño fijo — preserva
  contexto y permite citar la fuente exacta.
- **Grounding a query-time** (diseño futuro, no en este alcance): búsqueda híbrida
  (vectorial + keyword) + reranking + prompt con citación forzada y umbral de
  confianza para negarse a responder si no hay buen contexto.
- **Modelo de IA para generación** (diseño futuro): a definir entre Groq (rápido/
  barato, uso actual en OCR/clasificación) y Kimi K3 (razonamiento más profundo,
  candidato para el consejero / Q&A de la bóveda) — no bloquea la indexación.

## Alcance de este diseño: pipeline de indexación

### Esquema de datos

Nuevo modelo en `prisma/schema.prisma`:

```prisma
model VaultChunk {
  id          String   @id @default(uuid()) @db.Uuid
  sourceFile  String   // path relativo dentro del vault, ej: "Costeo/Metodo-FIFO.md"
  sourceTitle String   // título de la nota (H1 o nombre de archivo)
  headingPath String?  // ej: "Costeo por Procesos > Método FIFO"
  content     String   // texto del chunk
  contentHash String   // sha256 del content — evita re-embedear si no cambió
  chunkIndex  Int
  vaultCommit String   // sha del commit del vault de origen (trazabilidad)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@unique([sourceFile, chunkIndex])
}
```

La columna `embedding vector(1024)` (dimensión de `voyage-3`) se agrega vía SQL
crudo en la migración, ya que Prisma no tiene tipo nativo para `vector` — se
mapea como `Unsupported("vector(1024)")` en el schema para que Prisma lo ignore
en la API generada pero la columna exista.

La migración también corre `CREATE EXTENSION IF NOT EXISTS vector;`.

No lleva RLS: es conocimiento compartido de referencia, no dato de un tenant
(mismo criterio que `MacroSnapshot` o el catálogo de cargas sociales).

### Módulos nuevos

- `src/infrastructure/ai/voyage-service.ts` — cliente de Voyage AI, mismo estilo
  que `GroqService` (`isConfigured`, manejo de errores no-fatal, no rompe si
  falta la key).
- `src/application/vault-indexer/vault-indexer-service.ts` — chunking + orquestación
  del indexado.
- `src/application/vault-indexer/markdown-chunker.ts` — lógica pura de troceo
  estructurado (testeable sin red ni DB).
- Script `npm run vault:index -- <path>` (mismo patrón que `db:seed`).

### Flujo del indexador (idempotente)

1. Recorre los `.md` del path dado, ignorando `.obsidian/` y `.trash/`.
2. Trocea cada nota por headers (`##`/`###`), conservando el título de la nota
   (H1 o nombre de archivo) como contexto de cada chunk.
3. Por cada chunk calcula `contentHash` (sha256). Si ya existe en la DB con el
   mismo hash para ese `sourceFile` + `chunkIndex`, lo salta (no gasta en
   re-embedear algo sin cambios). Si es nuevo o cambió, llama a Voyage y hace
   upsert (incluyendo el embedding vía raw SQL).
4. Al final, borra de la DB los chunks cuyo `sourceFile` ya no existe en el
   filesystem (notas eliminadas/renombradas).
5. Se puede correr las veces que haga falta después de un `git pull` del vault.

### Manejo de errores

- Si Voyage no está configurado (`isConfigured === false`), el script debe
  fallar rápido y claro (a diferencia del chat, acá no hay fallback útil: sin
  embeddings no hay indexación posible).
- Si Voyage falla para un chunk puntual (rate limit, timeout), se reintenta una
  vez y si vuelve a fallar se loguea y se sigue con el resto — no aborta todo
  el indexado por un chunk.

### Testing

- `markdown-chunker.ts`: tests unitarios puros (sin red/DB) cubriendo notas con
  múltiples niveles de headers, notas sin headers, notas vacías, y detección
  de cambios de hash.
- `vault-indexer-service.ts`: tests con Voyage y Prisma mockeados, cubriendo
  alta de chunk nuevo, skip por hash sin cambios, y borrado de chunks huérfanos.

## Fuera de alcance (diseños futuros)

- Búsqueda a query-time (hybrid search + reranking).
- Endpoint/servicio que responde preguntas usando los chunks recuperados.
- Pipeline nocturno de recolección de correcciones y promoción a la bóveda.
- Sistema de roles (admin / validador de contenido).
