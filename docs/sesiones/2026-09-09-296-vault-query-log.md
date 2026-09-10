# Bitácora — issue #296: vault_query_log + feedback 👍/👎

## Qué se hizo

- Modelo `VaultQueryLog` (`@@map("vault_query_log")`, sin RLS — operativo, no dato de tenant) +
  migración aditiva. Campos: `question`, `retrieverVersion`, `embeddingModel`, `llmModel`,
  `chunksReturned` (Json: `[{sourceFile, headingPath, distance}]`), `confidence`,
  `answeredFromContext`, `latencyMs`, `userId?`, `feedbackUseful?`, índice por `createdAt`.
- `VaultQueryService.query(question, opts?)` — nueva firma con `opts.userId`. Escribe **una fila
  por invocación** (miss, éxito, o "el LLM no devolvió nada"). El `query()` devuelve `queryLogId`
  en el resultado para poder asociar el feedback.
- `logQuery()` privado: **nunca puede romper la respuesta** — cualquier error de la escritura se
  loguea y devuelve `undefined` (DOM-04). Verificado con un test que fuerza el rechazo del
  `create`.
- `POST /vault/query/:id/feedback` con `{ useful: boolean }` → setea `feedbackUseful`; 404 si el
  id no existe, 400 si falta `useful`. Las dos rutas de query (`/vault/query` y
  `/vault/sessions/:id/query`) ahora pasan `userId`.
- `EMBEDDING_MODEL` se exportó desde `voyage-service.ts` para no hardcodear el string.
- `vault_query_log` agregada a la lista de exenciones de RLS en `tests/config/rls-coverage.test.ts`
  con su motivo.

## Decisiones

- **La "precisión proxy" del panel NO se tocó todavía** — eso es #300 (F1-16), que consume esta
  tabla. Acá solo se genera el dato.
- `llmModel` se guarda como `'groq'` fijo y `retrieverVersion` como `'v1-cosine'`: los hará reales
  #301 (F1-10) y #295 (F1-07). Se dejan como constantes para que el gráfico histórico distinga
  las corridas cuando cambien.
- La firma de `query()` pasó de `(question, maxResults=5)` a `(question, opts={})`. Ningún caller
  pasaba el segundo argumento (verificado con grep), así que no rompe nada.

## Fuera de alcance

El panel admin (#300). El endpoint viejo `POST /vault/feedback` (texto libre → `daily_signal`
`USER_CORRECTION`) se conserva tal cual: es otra cosa.

## Verificación

```
npm run prisma:generate · npm run typecheck · npm run check:tests-base   # verde
npx eslint <archivos tocados>                                            # sin errores
npx vitest run tests/config/rls-coverage.test.ts                         # 7 verdes
npx vitest run --config vitest.integration.config.ts tests/integration/vault-query-log.test.ts
  # 3 verdes (miss NONE, hit HIGH, y "si el log falla la respuesta igual sale"), rol costear_app
npx vitest run tests/http/vault-query-feedback.test.ts                   # 3 verdes (200, 404, 400)
npx vitest run --exclude 'tests/http/**'                                 # 1480 verdes, 1 skip
npx vitest run tests/http --no-file-parallelism                          # 85 verdes
```
