# Bitácora — issue #300: panel admin, métricas reales del RAG (backend)

## Qué se hizo

`GET /admin/stats` deja de calcular la "precisión proxy" (`1 - RAG_MISS/total`, que el propio
comentario admitía como proxy porque solo se guardaban los misses). El bloque `vault` ahora trae,
desde `vault_query_log`:

- `queries7d` / `queries30d`
- `byConfidence` — `{ HIGH, LOW, NONE }` de los últimos 30 días
- `refusalRate` — `NONE / total`
- `feedback` — `{ up, down, withFeedbackPct }` (👍/👎 de `feedbackUseful`)
- `topCitedFiles` — top 10 `sourceFile` citados, vía `jsonb_array_elements(chunksReturned)`
- `recentMisses` — las últimas 10 preguntas con `confidence = 'NONE'`

Se quitaron `ragMisses` y el comentario de "rough precision". `signalsBySource`, `pendingSignals`,
`totalChunks` y `userCorrections` se conservan.

## Decisiones

- **`queryLog: null` cuando `queries30d === 0`**: no mostrar ceros como si fueran datos (mismo
  criterio de "sin datos" que el frontend aplica en otros lados).
- **`topCitedFiles` con `$queryRaw`**: desanidar el array JSONB `chunksReturned` no se puede con la
  API de Prisma; una query cruda acotada a 30 días y `LIMIT 10` es lo más directo.
- **Ventanas de 7/30 días** fijas por ahora; si hace falta parametrizarlas es otro issue.

## Fuera de alcance

**El componente del panel en `CosteAR-admin`** que dibuja estos números — es otro repo y otro PR
(por eso el issue queda `part of #300`, no `Closes`). Namespaces en la UI (filtro por fuente): Fase 2.

## Verificación

```
npm run typecheck · eslint                                # verde
npx vitest run tests/http/admin-stats.test.ts             # 2 verdes (sin tráfico → queryLog null; con tráfico → confianza/negativa/feedback/topCited)
npx vitest run --exclude 'tests/http/**'                  # 1511 verdes, 1 skip
npx vitest run tests/http --no-file-parallelism           # 87 verdes
```
