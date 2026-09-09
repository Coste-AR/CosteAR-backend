# Bitácora — issue #297: Contextual Retrieval (prefijo por chunk)

## Qué se hizo

- **`contextual-prefix.ts`** — `ContextualPrefixGenerator.generate(docText, chunkContent)`: le pasa
  a un modelo barato (`getLLMService('context')`, Claude Haiku por default) el **documento completo
  en el `system` con `cacheSystem: true`** —se cachea una vez y se reusa para todos los chunks del
  mismo archivo— y el chunk en el `user`. Devuelve un contexto de 1-2 frases, o `null` si el LLM no
  está configurado / falla / responde vacío. La resolución del LLM es **perezosa** (no evalúa
  `getEnv()` al construir).
- **`markdown-chunker.ts`** — `MarkdownChunk` suma `contextualPrefix: string | null` (`null` al
  salir del chunker).
- **`vault-indexer-service.ts`** — 3er parámetro `contextGen`. En Fase 1 guarda el texto completo
  de cada archivo. En Fase 2, por cada chunk a embeber: genera el prefijo, embebe
  `prefijo + "\n\n" + content` (o el content pelado si no hay prefijo), y lo persiste en
  `contextualPrefix`. Nuevo campo `chunksWithContext` en `IndexVaultResult`.

## Decisiones

- **`contentHash` NO incluye el prefijo** (el plan sugería incluirlo). Motivo: si lo incluyera, la
  detección de "chunk sin cambios" de Fase 1 —que compara el hash de `chunkMarkdown` (sin prefijo)
  contra el guardado— fallaría siempre, y el nightly regeneraría el prefijo + re-embebería **todos**
  los chunks en cada corrida. Con el hash sobre contenido crudo, el prefijo se regenera solo cuando
  el contenido del chunk cambió. El costo: si alguien edita solo la intro de un documento, los
  prefijos de sus otros chunks quedan levemente desactualizados hasta que esos chunks cambien o se
  fuerce un reindex. Es un trade-off aceptable para un resumen de 1-2 frases.
- **Batch API queda pendiente**: hoy son llamadas secuenciales con el documento cacheado (barato
  con Haiku + caching, y el reindex es incremental — solo chunks cambiados). El endpoint async de
  Batch (–50% extra) es una optimización para otro issue si el volumen lo justifica.
- **`generate()` envuelto en `.catch(() => null)`** en el indexador: un LLM caído nunca frena la
  indexación, solo se pierde el prefijo de ese lote.

## Fuera de alcance

Re-embeddeo masivo de la bóveda existente (lo hace el próximo reindex por cambio de contenido, o un
`forceClone`). El uso del prefijo en el retrieval ya está: se embebe junto al contenido.

## Verificación

```
npm run typecheck · eslint                                # verde
npx vitest run tests/vault-indexer/                       # 48 verdes (42 previos + 6: prefijo antepuesto y persistido, degradación ante error del LLM, truncado del doc, LLM no configurado)
npx vitest run --exclude 'tests/http/**'                  # 1517 verdes, 1 skip
npx vitest run tests/http --no-file-parallelism           # 85 verdes
```
