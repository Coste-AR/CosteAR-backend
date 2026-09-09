# Bitácora — issue #292: vault_chunks.sourceType + contextualPrefix

## Qué se hizo

- Enum `VaultSourceType` (`CATEDRA | PROCESOS | APRENDIZAJE`) y dos columnas nullable en
  `vault_chunks`: `sourceType` (namespace por origen) y `contextualPrefix` (lo llenará F1-05).
- Migración aditiva `20260909190430_add_vault_chunk_sourcetype_context` con backfill del
  `sourceType` por carpeta (cubre la estructura nueva `conocimiento/<ns>/…` y la actual previa a
  F1-02: `001.1 - Clases%` → CATEDRA, `costeo-procesos/%` → PROCESOS).
- `vault-chunk-repository.ts`: `UpsertChunkInput` acepta `sourceType?`/`contextualPrefix?`;
  `upsertChunk` los persiste y el `ON CONFLICT` los actualiza. Helper exportado
  `deriveSourceType(sourceFile)` que se usa cuando el caller no pasa `sourceType`.

## Decisión: la migración se escribió a mano

`npm run prisma:migrate` no la pudo generar limpia. Prisma fusiona en **un solo bloque**
`ALTER TABLE "vault_chunks"` los `ADD COLUMN` nuevos junto con la deriva estructural conocida
(`ALTER COLUMN "contentTsv" DROP DEFAULT`). `scripts/lib/filtrar-deriva.mjs` filtra por **bloque**
(`sql.split(/\n\n+/)`), así que al sacar la deriva se llevaba también los `ADD COLUMN` — la
migración quedaba con solo el `CREATE TYPE`.

Se escribió `migration.sql` a mano con solo las sentencias aditivas + backfill, con un header que
explica por qué. `migrate deploy` (CI/staging/prod) la aplica verbatim, sin pasar por el filtro.
Los índices HNSW/GIN y la columna generada `contentTsv` siguen viviendo solo en el SQL de sus
migraciones originales, exactamente como antes — verificado: `prisma migrate status` dice "up to
date" y los dos índices siguen en la base.

**Seguimiento (issue nuevo):** `filtrar-deriva.mjs` debería filtrar a nivel de sentencia, no de
bloque, para que un `ADD COLUMN` a `vault_chunks` no vuelva a chocar con esto.

## Fuera de alcance

Usar `sourceType` en el retrieval (#295, F1-07) o en la UI del panel (Fase 2). El `contextualPrefix`
lo genera y persiste #297 (F1-05).

## Verificación

```
npm run prisma:generate                    # cliente al día
npm run typecheck                          # verde
npx eslint <archivos tocados>              # sin errores
npm run check:tests-base                   # verde (test nuevo declarado por tests/integration/**)
npx vitest run --config vitest.integration.config.ts tests/integration/vault-chunk-repository.test.ts
  # 3 verdes, con rol costear_app (NOBYPASSRLS) y MIGRATION_DATABASE_URL del dueño
npx vitest run --exclude 'tests/http/**'   # 1480 verdes, 1 skip
```

DB local: `prisma migrate status` → "Database schema is up to date"; `vault_chunks` tiene las dos
columnas nullable; el enum tiene los 3 valores; `vault_chunks_embedding_idx` y
`vault_chunks_content_tsv_idx` intactos.
