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

> ⚠️ **`staging` es producción**: hay un cliente real usándolo.
> *(Los issues #88, #89 y #90 que esta nota mencionaba quedaron resueltos el 21-08.)*  
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
- [ ] **`node scripts/check-migrations.mjs` contra el ambiente destino da verde** (ver Paso 0 de la sección 2). Si da 🟡 o 🔴, resolverlo ANTES de promover — no durante el deploy.
- [ ] **Verificar que el trabajo llegó a `dev`**, no que los PRs figuran mergeados (REV-08). Entre el 20 y el 21-08 pasó tres veces que un PR quedó en verde con el trabajo afuera: `git log origin/dev` y mirar los archivos, no la lista de PRs.

---

## 2. Cómo correr las migraciones en producción

### Paso 0 — Diagnóstico (SIEMPRE, y antes de tocar nada)

**Dónde se corre:** en tu computadora, en una terminal parada en la carpeta del backend
(`costear_repo/costear-api/CosteAR-backend`). No se corre dentro de Railway ni en la web.

#### Opción A — con Railway CLI (la más simple, no hay que copiar credenciales)

```powershell
railway link            # elegir el proyecto y el ambiente STAGING
railway run node scripts/check-migrations.mjs
```

`railway run` inyecta las variables del ambiente solo. Si no tenés el CLI: `npm i -g @railway/cli`
y después `railway login`.

#### Opción B — a mano, pegando la URL

**1.** En [railway.app](https://railway.app) → proyecto → ambiente **staging** → servicio
**Postgres** → pestaña **Variables**.

**2.** Copiar **`DATABASE_PUBLIC_URL`** (la que tiene `proxy.rlwy.net` o similar).

> ⚠️ **No sirve `DATABASE_URL` a secas si dice `postgres.railway.internal`**: esa dirección solo
> existe *dentro* de Railway y desde tu máquina no resuelve. Es el motivo más común de que esto
> "no funcione".

**3.** En la terminal, **PowerShell** (es la de Windows por defecto):

```powershell
$env:DATABASE_URL = "postgresql://...pegar acá la URL pública..."
node scripts/check-migrations.mjs
```

Si usás **Git Bash** en vez de PowerShell, es distinto:

```bash
DATABASE_URL="postgresql://..." node scripts/check-migrations.mjs
```

> ⚠️ `VARIABLE=valor comando` **es sintaxis de bash y no funciona en PowerShell**: ahí hay que
> setear `$env:` en una línea aparte, como arriba.

**4.** Al terminar, borrar la variable para no dejar la credencial de producción dando vueltas en
esa terminal:

```powershell
Remove-Item Env:\DATABASE_URL
```

**Nunca** pegar esa URL en un archivo del repo, en un issue ni en un chat: lleva usuario y
contraseña de producción.

#### Cómo leer el resultado

Lo primero que imprime es **contra qué base está mirando**:

```
📍 Mirando: railway en containers-us-west-1.proxy.rlwy.net:6543
```

Si ahí dice `localhost`, estás mirando tu base local y **el resultado no dice nada de staging**.
El script te avisa, pero conviene mirarlo igual.

Solo lee. Contesta la pregunta que decide todo lo que sigue: **si hay una migración
marcada como fallida, ¿dejó algo hecho o no dejó nada?** Según la respuesta, la acción
correcta es la **opuesta** en cada caso:

| Veredicto | Qué hacer |
| --- | --- |
| 🟢 No dejó nada | Nada especial: `migrate-deploy.mjs` la re-aplica solo |
| 🟡 Ya está aplicada de hecho | `npx prisma migrate resolve --applied "<nombre>"` — y **recién después** deployar |
| 🔴 Parcial | Limpieza a mano. **No automatizar**: hay que mirar qué quedó a medias |

> ⚠️ **Por qué este paso existe.** `migrate-deploy.mjs` marca toda migración fallida como
> `rolled-back` para reintentarla. Eso arregla el caso común y **rompe el caso 🟡**: si la
> migración ya se aplicó y quedó mal registrada, reintentarla falla con `already exists` y el
> deploy queda a medias.
>
> No es teórico. El 21-08, en la base de desarrollo,
> `20260818031500_activos_amortizables_y_desperdicio` figuraba *iniciada y nunca terminada* desde
> el 19-08, y sin embargo **todos sus objetos existían**. Si `staging` tiene el mismo registro, el
> primer deploy que se intente ahí va a cortar.

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

> ✅ **Resuelto el 21-08.** `railway.toml` corre `npm run db:setup` como `preDeployCommand`, o sea
> **migraciones + políticas RLS antes de que el deploy salga vivo**. Si falla, Railway mantiene la
> versión anterior: no deja el servidor sin su schema ni con tablas nuevas sin aislamiento.
>
> Antes corría solo `migrate-deploy.mjs`, y eso dejaba un hueco silencioso: una migración que
> agregaba una tabla la creaba en producción **sin políticas RLS**, porque `apply-rls.mjs` se
> corría a mano. Una tabla sin política no falla ni avisa — devuelve las filas de todos los
> inquilinos.
>
> **Los pasos 1 y 2 de abajo ya no hay que correrlos a mano en un deploy normal.** Quedan
> documentados para cuando haya que intervenir (por ejemplo, después de un 🟡 del Paso 0).

- [x] ¿Railway corre `npm run db:setup` automáticamente en cada deploy? **Sí**, vía `preDeployCommand`.
- [ ] ¿Cuál es el comando de build/start configurado en Railway para cada ambiente?
- [ ] ¿Existe un `Procfile` o configuración de Railway que orqueste la secuencia?

---

## 3. Verificar que el deploy salió bien

### Endpoint de health check

```bash
curl https://<URL_RAILWAY_STAGING>/health
```

Devuelve:

```json
{
  "status": "ok",
  "version": "<SHA del commit deployado>",
  "environment": "staging",
  "ts": "2026-08-21T20:00:00.000Z"
}
```

> ✅ **Ya no hace falta anotar el SHA a mano.** `version` sale de `RAILWAY_GIT_COMMIT_SHA`, que
> Railway inyecta en cada deploy. Preguntarle al ambiente qué está corriendo siempre va a ser más
> confiable que una planilla que alguien tiene que acordarse de actualizar.
>
> Si dice `"desconocido"`, es que la variable no está: el endpoint **no inventa** un valor, porque
> un SHA plausible pero falso es peor que ninguno.

> ✅ **Desde el 22-08 esto lo verifica el CI solo.** El workflow **Smoke post-deploy**
> (`.github/workflows/post-deploy-smoke.yml`) corre después de cada push a `staging` o `main`,
> consulta `/health` hasta 12 veces y **falla en rojo si el ambiente no termina sirviendo el commit
> que se mergeó**. Ya no hay que acordarse de mirar: si no aparece en Actions, el deploy no llegó.
>
> Para re-verificar un ambiente sin pushear nada: Actions → *Smoke post-deploy* → **Run workflow**.
>
> ⚠️ **Hueco de infra que queda** — el workflow necesita las URLs **públicas** de Railway, cargadas
> como variables de repositorio en *Settings → Secrets and variables → Actions → Variables*:
> - `STAGING_HEALTH_URL`: `_______________`
> - `MAIN_HEALTH_URL`: `_______________`
>
> La URL **interna** (`.railway.internal`) no sirve: no resuelve desde afuera de Railway. Mientras
> falten, el workflow **falla diciendo cuál falta** en vez de dar un verde vacío.

### Verificar el SHA que quedó corriendo

Lo hace el CI. A mano, si hace falta:

```bash
# El SHA que debería estar corriendo:
git rev-parse origin/staging

# Y el mismo chequeo que corre el workflow, desde cualquier máquina:
node scripts/smoke-deploy.mjs --url https://<URL_RAILWAY_STAGING> --sha $(git rev-parse origin/staging)
```

> El script distingue tres situaciones que a ojo se confunden: **el ambiente todavía sirve la
> versión anterior** (sigue esperando), **no responde** (reiniciando o caído, sigue esperando) y
> **dice `desconocido`** (falta `RAILWAY_GIT_COMMIT_SHA`, aborta enseguida porque esperar no lo
> arregla).

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
