# Qué cambió el 22-08-2026, y por qué

> **Para el equipo — y para la IA que trabaje en cualquiera de los tres repos.**
>
> En un día se cambiaron tres cosas que afectan a todos: **cómo se abren y mergean los PRs**, **cómo
> se verifica un deploy** y **qué significa cada ambiente**. Este documento dice exactamente qué
> pasó, en qué orden, y qué hay que hacer distinto de ahora en más.
>
> No hay nada que instalar. Sí hay tres hábitos que cambian.

---

## 1. Lo que tenés que saber, si solo leés esta sección

| Antes | Ahora |
|---|---|
| El PR se abría y se mergeaba cuando estaba verde | **El PR nace en `--draft`.** GitHub no deja mergear un borrador |
| Se mergeaba a mano, mirando el CI | **`gh pr merge --auto --squash`**: GitHub mergea solo cuando el CI pasa |
| Después de deployar, alguien tenía que anotar el SHA | **El CI verifica solo** que el ambiente esté sirviendo el commit mergeado |
| `staging` era producción y `main` no deployaba nada | **`staging` = pre-producción · `main` = producción** |
| Las ramas mergeadas quedaban para siempre | **Se borran solas** al mergear |

**El flujo completo, de punta a punta:**

```bash
# 1. Rama desde dev
git checkout -b feat/lo-que-sea origin/dev

# 2. El PR nace en borrador. Podés seguir pusheando tranquilo.
gh pr create --base dev --draft --title "feat(scope): ..." --body "..."

# 3. Cuando de verdad terminaste (tests, lint, typecheck en verde y TODO pusheado):
gh pr ready

# 4. Y en vez de esperar mirando la pantalla:
gh pr merge --auto --squash

# 5. Después de mergear, verificá que el trabajo LLEGÓ (no que el PR está verde):
git log origin/dev --oneline -3
```

---

## 2. Por qué se cambió: el diagnóstico

No salió de una preferencia de estilo. Salió de medir tres días de trabajo (20 al 22-08):

> **Se abrieron 24 PRs en el backend. Cuatro —el 17 %— no agregaron nada: existieron solo para
> recuperar trabajo que ya estaba hecho y no había llegado a `dev`.**

Lo que **no** era el problema, medido antes de tocar nada:

| Sospechoso | Medición | Veredicto |
|---|---|---|
| El código | 1.420 tests, suite en verde | No es |
| El CI | 42 corridas exitosas contra 2 fallidas (95 %) | No es |
| La doctrina | Cinco ADR verificados contra la cátedra | No es |

### La causa

El trabajo se pushea de a poco: se abre el PR y se le siguen agregando commits. Quien mergea ve un
PR abierto y en verde, y lo mergea. **Nada distinguía «esto está listo» de «esto todavía está
creciendo».**

| PR | Se mergeó | El commit que faltaba llegó | Diferencia |
|---|---|---|---|
| #119 | 15:09:49 | 15:21:32 | **12 minutos después** |
| #122 | 16:12:25 | 18:04:01 | ~2 horas después |

Y el agravante de método, que es el que ordena todo lo demás:

> **REV-08 ya estaba escrita, por este mismo accidente, el 18-08. La regla existía, estaba
> redactada, y volvió a pasar tres veces en los tres días siguientes.**
>
> **Una regla que hay que recordar en el momento exacto no es un control: es una intención.**

La tesis del diagnóstico, en una línea:

> **Todo lo que dependía de la memoria de una persona falló. Todo lo que estaba automatizado
> funcionó.**

Por eso ninguno de los cambios de abajo es una regla nueva para acordarse. Todos son mecanismos que
funcionan sin que nadie los recuerde.

---

## 3. Lo que se cambió, en orden

### Fase 0 — Las casillas de GitHub

Estaban apagadas. Se prendieron en los tres repos:

| Control | Estado | Qué cierra |
|---|---|---|
| `delete_branch_on_merge` | ✅ los 3 repos | Las ramas mergeadas se borran solas |
| `allow_auto_merge` | ✅ backend y frontend · ❌ admin | Habilita `gh pr merge --auto` |

> ⚠️ **`CosteAR-admin` no soporta auto-merge**: es privado y el plan Free no lo incluye. Ahí el
> draft funciona igual y el merge se hace a mano con el CI en verde.

**Poda de ramas**: se borraron **137 ramas** ya mergeadas, con el SHA de cada una respaldado antes.

| Repo | Antes | Después |
|---|---|---|
| backend | 86 | **8** |
| frontend | 43 | **6** |
| admin | 24 | **5** |

Para recuperar cualquiera: `git push origin <SHA>:refs/heads/<nombre>`.

> 🔍 **Dato útil**: `git branch --merged dev` **no detecta las ramas mergeadas con squash**, porque
> el squash genera un commit distinto. Diez ramas quedaron dando vueltas por eso.
> `delete_branch_on_merge` sí las borra, porque GitHub sabe que el PR se mergeó aunque git no lo vea.

**Dos casillas se descartaron a propósito**: `require_last_push_approval` y `dismiss_stale_reviews`.
GitHub las evalúa sobre el requisito de aprobaciones, que está en 0. Sin aprobaciones exigidas no
hay nada que invalidar. Activarlas habría sido **teatro de seguridad**: dos casillas en verde que no
protegen nada, que es peor que tenerlas apagadas y saberlo.

### Fase 1 — La señal de «terminé»

PRs **#128** (backend), **#61** (frontend), **#35** (admin).

Reglas nuevas en el `CLAUDE.md` de los tres repos, y `/costear-pr` reescrita para abrir en borrador:

- **PR-04** — Todo PR nace en DRAFT. Se marca `gh pr ready` cuando está listo de verdad, y se dice
  **«terminé de pushear»**.
- **PR-05** — Para mergear se usa `gh pr merge --auto --squash`, no el botón a mano.
- **PR-06** — Después de mergear, verificar que el trabajo **llegó** (`git log origin/dev`), no que
  el PR figura en verde.

> **Por qué PR-06 existe:** un PR apilado que se mergea contra su rama de abajo aparece como
> `MERGED` en verde **y el trabajo no llega a `dev`**. Pasó tres veces entre el 20 y el 21-08.

### Fase 2 — El deploy se verifica solo

PRs **#129**, **#130**, **#132**, **#134**.

Un workflow (`.github/workflows/post-deploy-smoke.yml`) corre después de cada push a `staging` o
`main`, consulta `/health` del ambiente y **compara el SHA que devuelve contra el commit mergeado**.
Si no coincide dentro de la ventana (12 intentos × 15s), **falla en rojo**.

Reemplaza el paso manual del runbook —«anotá el SHA después de cada deploy»— que **nunca se
ejecutó**. Durante la auditoría, la pregunta *«¿este defecto está afectando al cliente?»* quedó sin
respuesta **tres veces**, siempre por no saber qué versión corría dónde.

**Cómo lo corrés a mano:** Actions → *Smoke post-deploy* → **Run workflow** → en *Use workflow from*
elegí **`staging`** o **`main`** (no `dev`: no deploya a ningún lado).

---

## 4. Los ambientes: qué significa cada uno ahora

**Este es el cambio que más cuesta interiorizar, porque lo que había escrito era falso.**

```
feature-branch → dev → staging → main
                        │          │
                        │          └──> ambiente "production"  = PRODUCCIÓN
                        └──> ambiente "staging"   = PRE-PRODUCCIÓN
```

| Ambiente Railway | Rama conectada | Qué es |
|---|---|---|
| `staging` | `staging` | **Pre-producción** — acá se prueba |
| `production` | `main` | **Producción** |

### Qué había antes, y cómo se descubrió

Al cargar las URLs para el smoke, los dos ambientes respondieron **el mismo commit**:

```
staging     → version cdce3171…  environment "staging"
production  → version cdce3171…  environment "production"
```

`cdce3171` era el HEAD de la rama `staging`. Confirmado en Railway → Settings → Source: **los dos
ambientes tenían conectada la rama `staging`**.

Consecuencias que eso reescribe:

- **`main` no deployaba a ningún lado.** Sus 449 commits de atraso (issue #94) nunca fueron
  desatención: **no la usaba nadie.**
- **Un merge a `staging` publicaba dos veces**, y no existía ningún ambiente donde probar antes.

### El orden del arreglo, que importó

1. Promover `dev → staging` (PR #131)
2. Promover `staging → main` (PR #133) — **457 commits**
3. **Recién ahí**, reconectar el ambiente `production` a `main` en Railway
4. Mergear el mapa nuevo en el workflow (PR #132)

> ⚠️ **Si se hubiera reconectado Railway primero**, production habría deployado código de 39 días
> atrás **contra una base que ya tiene todas las migraciones aplicadas**. Prisma no revierte
> migraciones: la base queda adelante y el código viejo choca con columnas que no conoce.
>
> Si algún día se rehace este mapa, el orden es el mismo: **primero que la rama alcance, después
> reconectar.**

### Estado verificado al cierre

```
main:    2cad3f18   →  ambiente production sirve 2cad3f18  ✅
staging: 6a18cbab   →  ambiente staging    sirve 6a18cbab  ✅
```

### Aislamiento de las bases

Verificado el 22-08: **los dos ambientes tienen bases de datos separadas** (instancias distintas,
credenciales distintas). Eso importa más de lo que parece, porque `railway.toml` corre
`npm run db:setup` —migraciones **y** políticas RLS— como `preDeployCommand` en cada deploy:

> **Con bases separadas es exactamente lo correcto. Con base compartida, cada deploy a
> pre-producción migraría producción.**

Cómo verificarlo: Railway → ambiente → servicio backend → **Variables** → `DATABASE_URL`.

| Lo que dice | Veredicto |
|---|---|
| `${{Postgres.DATABASE_URL}}` o host `postgres.railway.internal` | ✅ aislado y por red interna |
| URL literal con host público (`…proxy.rlwy.net`) | ⚠️ funciona, pero sale a internet (ver pendientes) |

---

## 5. El primer deploy verificado sin que nadie mirara

Al mergear el PR #131, el smoke corrió solo por primera vez
([run 32587408436](https://github.com/Coste-AR/CosteAR-backend/actions/runs/32587408436)):

```
production: … intento 1/12: el ambiente todavía corre cdce3171…, se esperaba 6a18cbab…
            ✔ Intento 2/12: el ambiente corre 6a18cbab…

staging:    … intento 1/12: el ambiente no responde (timeout)   ← reiniciando
            ✔ Intento 2/12: el ambiente corre 6a18cbab…
```

Los dos ejercitaron el camino de espera antes de aprobar. **El chequeo distingue de verdad**, no da
verde por defecto. El deploy entero quedó verificado en 25 segundos.

---

## 6. Un bug del propio chequeo, encontrado en vivo

Mirando el primer deploy de `production` a `main`, el `/health` devolvió:

```
{"status":"starting"}     HTTP 200
```

No es nuestro endpoint: es un cuerpo que sirve **el edge de Railway** mientras el contenedor
arranca. El chequeo lo leía como «el endpoint respondió mal» y **abortaba**, justo en el momento en
que su trabajo es tener paciencia.

Corregido en el PR **#134**. La ausencia de `version` ahora se resuelve mirando **quién contesta**:

| Cuerpo | Quién es | Qué hace |
|---|---|---|
| sin `status: ok` (ej. `starting`) | Railway arrancando, un proxy, un error del edge | 🔁 **esperar** |
| `status: ok` **sin** `version` | nuestro `/health`, con el contrato roto | ⛔ **abortar** |

Se anota porque es el patrón que se repite en todo este trabajo: **la diferencia entre una señal y
un ruido está en distinguir quién habla.**

---

## 7. Decisiones que se tomaron y NO se van a repetir

Para no volver a discutirlas:

| Alternativa | Por qué no |
|---|---|
| Exigir aprobación de review para mergear | Se desactivó el 15-08 por una razón real: con 4 personas, traba. Draft + auto-merge atacan la misma causa **sin** poner a nadie a esperar |
| Prohibir los PRs apilados | El apilamiento **no era la causa**: el cuarto incidente fue un PR simple contra `dev`. Sería tratar un síntoma y perder una herramienta útil |
| Escribir otra regla en `CLAUDE.md` | Es lo que ya se hizo con REV-08 el 18-08. Volvió a pasar tres veces |
| Migrar el deploy a GitHub Actions | Railway ya deploya y corre migraciones + RLS. Cambiar de plataforma es un proyecto, no un arreglo |

---

## 8. Lo que queda pendiente

| # | Qué | Dónde |
|---|---|---|
| 1 | El servicio backend de `production` usa la **URL pública** de su base en vez de la interna: sale a internet, paga egress y expone la base | Railway → production → backend → Variables |
| 2 | **Fase 3** — la deriva del schema: `prisma migrate diff` arrastra 9 sentencias destructivas que obligan a escribir cada migración a mano | issue #72 |
| 3 | **Fase 4** — bajar el ruido: un test que falla por timeout de 5s, 20 warnings de lint preexistentes | — |
| 4 | **Fase 5** — Definition of Done única para los tres repos | — |
| 5 | Datos comerciales de un cliente en repos públicos | admin #18 |

> Sobre el punto 3: hay un test —`tests/classifier/cascade-section-decision.test.ts`— que **falla en
> local y pasa en el CI**. Verificado sobre `dev` limpio: es preexistente. Mientras siga así,
> **enseña a ignorar el semáforo**, y un semáforo que se ignora es peor que no tenerlo.

---

## 9. Índice de PRs

| PR | Repo | Qué |
|---|---|---|
| [#128](https://github.com/Coste-AR/CosteAR-backend/pull/128) | backend | Fase 1 — draft + auto-merge (PR-04/05/06) |
| [#61](https://github.com/Coste-AR/CosteAR-frontend/pull/61) | frontend | Fase 1 |
| [#35](https://github.com/Coste-AR/CosteAR-admin/pull/35) | admin | Fase 1 + el sync deja de publicar datos del cliente |
| [#129](https://github.com/Coste-AR/CosteAR-backend/pull/129) | backend | Fase 2 — el smoke post-deploy |
| [#130](https://github.com/Coste-AR/CosteAR-backend/pull/130) | backend | El hallazgo: los dos ambientes servían `staging` |
| [#131](https://github.com/Coste-AR/CosteAR-backend/pull/131) | backend | Promoción `dev → staging` |
| [#133](https://github.com/Coste-AR/CosteAR-backend/pull/133) | backend | Promoción `staging → main` (457 commits) |
| [#132](https://github.com/Coste-AR/CosteAR-backend/pull/132) | backend | El mapa final: staging=pre-prod, main=prod |
| [#134](https://github.com/Coste-AR/CosteAR-backend/pull/134) | backend | El smoke espera el arranque de Railway |

**Dónde está el detalle completo**: `Auditorias/2026-08-20 auditoria consolidada y reparto.md`,
secciones §9 (bitácora), §10 (diagnóstico) y §11 (el plan por fases).

**Las reglas vinculantes** viven en el `CLAUDE.md` de cada repo, no acá. Este documento explica el
porqué; el `CLAUDE.md` manda.
