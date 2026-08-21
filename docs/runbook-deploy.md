# Runbook de deploy — CosteAR Backend

> Creado para cerrar el issue #102 (P-01 de la auditoría del 19-08-2026).  
> **Actualizar este archivo después de cada promoción real a `main`** con lo que se aprendió.

---

## Contexto de ambientes

| Ambiente | Rama git | Plataforma | Qué sirve |
|---|---|---|---|
| Desarrollo | `feature/*` | local | Trabajo individual |
| Dev | `dev` | Railway (dev) | Integración continua |
| Staging | `staging` | Railway (staging) | **Producción actual** — hay un cliente real |
| Main | `main` | Railway (main) | Ambiente de referencia — hoy 39 días atrás |

> ⚠️ **`staging` es producción** mientras no se resuelvan los issues #88/#89/#90.  
> Promover a `main` es el objetivo, no el estado actual.

---

## Flujo de promoción

```
feature-branch → dev → staging → main
```

Cada flecha es un PR revisado. **No se saltean pasos.** GitHub bloquea push directo a `dev`, `staging` y `main`.

---

## 1. Antes de promover a staging (checklist pre-deploy)

Correr todo esto en la branch que se va a mergear:

```bash
npm run lint          # cero errores
npm run typecheck     # cero errores
npm test              # todos los tests en verde
```

Verificar manualmente:
- [ ] El CI de GitHub Actions está en verde en `dev` (no solo local)
- [ ] La migración que va en este PR **no contiene** `DROP INDEX`, `DROP TABLE`, ni `DROP COLUMN` sobre tablas con datos (DOM-06). Usar `git diff dev -- prisma/migrations/` para revisarla.
- [ ] Si la migración usa `npm run prisma:migrate`, el script `scripts/migrate-dev.mjs` la limpió automáticamente (ver CMD-04 en CLAUDE.md). Confirmar que el SQL en `prisma/migrations/` es solo aditivo.
- [ ] Ningún secreto ni dato de cliente en el diff (`git grep -in "DEMO_PASSWORD\|CosteAR2026"` devuelve vacío).

---

## 2. Cómo correr las migraciones en producción

Las migraciones se aplican en dos pasos, en ese orden:

### Paso 1 — Migrar el esquema

```bash
node scripts/migrate-deploy.mjs
```

Qué hace:
1. Detecta migraciones fallidas en `_prisma_migrations` y las marca como `rolled-back`
2. Corre `prisma migrate deploy` (aplica solo las pendientes, no interactivo)

Salida esperada:
```
═══════════════════════════════════════════
  CosteAR — deploy de migraciones Prisma   
═══════════════════════════════════════════

🔎 Buscando migraciones fallidas…
   No se detectaron migraciones fallidas.

🚀 Corriendo prisma migrate deploy…
   <lista de migraciones aplicadas>

✅ Migraciones aplicadas correctamente.
```

Si falla con un error de columna o tipo que ya existe → la migración no es idempotente. Revisar a mano y limpiar antes de reintentar.

### Paso 2 — Aplicar políticas RLS

```bash
node scripts/apply-rls.mjs
```

Aplica las políticas de Row Level Security sobre las tablas nuevas. Debe correr **después** de `migrate-deploy` porque necesita que las tablas ya existan.

### En Railway (infra)

> ⚠️ **Hueco de infra** — completar con quien administre Railway.

- [ ] ¿Railway corre `npm run db:setup` automáticamente en cada deploy, o hay que dispararlo a mano?
- [ ] ¿Cuál es el comando de build/start configurado en Railway para cada ambiente?
- [ ] ¿Existe un `Procfile` o configuración de Railway que orqueste la secuencia?

---

## 3. Verificar que el deploy salió bien

### Endpoint de health check

```bash
curl https://<URL_RAILWAY_STAGING>/api/v1/health
# Esperado: { "status": "ok", "version": "<SHA>" }
```

> ⚠️ **Hueco de infra** — completar:
> - URL de Railway para staging: `_______________`
> - URL de Railway para main: `_______________`
> - ¿El endpoint `/health` expone el SHA del commit? Si no, agregar `git rev-parse --short HEAD` al response.

### Verificar el SHA que quedó corriendo

```bash
# Desde el repo local, el SHA de staging después del deploy debería ser:
git rev-parse origin/staging

# Comparar con lo que reporta el health check o los logs de Railway.
```

### Qué mirar en Sentry

> ⚠️ **Hueco de infra** — completar:
> - Proyecto de Sentry: `_______________`
> - Después de un deploy, verificar que no aparezcan issues nuevos en los primeros 5 minutos.
> - Si se subió una migración destructiva por error, los primeros errores van a ser `column X does not exist` o `relation Y does not exist`.

### Verificación mínima post-migración

```bash
# Desde psql contra la DB de staging, confirmar que los índices de vault_chunks siguen:
SELECT indexname FROM pg_indexes WHERE tablename = 'vault_chunks';
# Debe devolver al menos: vault_chunks_pkey, vault_chunks_sourcefile_chunkindex_key,
#                         vault_chunks_embedding_idx, vault_chunks_content_tsv_idx
```

> ⚠️ **Hueco de infra** — quién tiene acceso a psql de Railway staging y cómo conectarse.

---

## 4. Rollback

### ¿Qué es reversible?

| Acción | Reversible | Cómo |
|---|---|---|
| Deploy de código | ✅ Sí | Revertir en Railway al SHA anterior |
| Migración aditiva (ADD COLUMN, CREATE TABLE) | ⚠️ Parcialmente | Requiere una migración de rollback manual |
| Migración destructiva (DROP) | ❌ No | Sin backup previo, los datos se pierden |

### Rollback de código en Railway

> ⚠️ **Hueco de infra** — completar con los pasos exactos en el panel de Railway:
> 1. Ir a Deployments en el proyecto
> 2. Seleccionar el deploy anterior (el que funcionaba)
> 3. `Redeploy`

### Rollback de una migración aditiva

Si la migración nueva rompe algo y necesita deshacerse:

1. Crear una nueva migración que revierta solo los cambios de la migración problemática (ej: `DROP COLUMN` si se hizo `ADD COLUMN`).
2. Aplicarla con `node scripts/migrate-deploy.mjs`.
3. No usar `prisma migrate reset` en producción — borra todos los datos.

### Qué NO hacer en producción

- `prisma migrate reset` — borra toda la DB
- `prisma db push` — aplica cambios sin registro en `_prisma_migrations`
- `DROP TABLE` directo en psql — irreversible sin backup

---

## 5. Registro de SHAs por ambiente

Después de cada promoción, registrar acá:

| Fecha | Ambiente | SHA | Quién | Notas |
|---|---|---|---|---|
| (pendiente primera promoción real) | — | — | — | — |

> Una vez que se resuelvan los issues #88, #89 y #90, actualizar esta tabla con el estado real de cada ambiente.

---

## 6. Pendientes de infra

Estos puntos necesitan datos que solo tiene quien administra Railway y Vercel. Están marcados con ⚠️ en las secciones de arriba:

- [ ] URL de Railway para staging y main
- [ ] Confirmar si Railway corre `db:setup` automáticamente o hay que dispararlo
- [ ] Acceso a psql de Railway (para verificación post-migración)
- [ ] Proyecto de Sentry y cómo navegar a los issues nuevos post-deploy
- [ ] ¿El endpoint `/health` expone el SHA? Si no, implementarlo

---

*Última actualización: 2026-08-21 — Runbook inicial. Completar sección 5 y los huecos de infra tras el primer deploy real.*
