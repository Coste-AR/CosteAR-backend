# Organización con Claude Code — evaluación y plan

- **Fecha:** 2026-09-09
- **Origen:** contenido del curso de Anthropic sobre Claude Code (sesiones largas, CLAUDE.md,
  skills, modos de permiso, hooks, rutinas/headless, GitHub Actions, verificación de corridas sin
  supervisión, plugins).
- **Para qué:** qué cumplimos como buena práctica, qué falta sumar, qué mejorar en cómo nos
  organizamos con todo este contenido, y un plan para implementarlo.
- **Nota de ubicación:** este doc habla de los 3 repos + la carpeta contenedora. Puede vivir en
  `CosteAR-admin` (que ya centraliza proceso y bitácora). Se deja acá para revisarlo junto con el
  del RAG.

---

## 1. Diagnóstico contra el curso

### 1.1 Lo que ya se hace bien (y mejor que el promedio)

| Tema del curso | Estado | Evidencia |
|---|---|---|
| **CLAUDE.md corto y específico** | ✅ Fuerte | Partido por rutas: `.claude/rules/dominio-costeo.md` (scoped a `prisma/`, `src/domain/`, `src/application/`), `frontend-ui.md` (scoped a `src/`), `bitacora.md` (scoped a `bitacora/`). Filosofía movida a `CosteAR-admin`. Cada regla con ID + fecha + fuente + "qué pasó por no tenerla". Registro de cambios del propio archivo. |
| **Reglas duras → mecanismo, no instrucción** | 🟡 Parcial | `SessionStart` hook (`briefing.mjs`) inyecta estado real de git/gh + `ESTADO.md`. `commitlint` en hook `commit-msg`. `--check-settings` para no romper `settings.json`. **Pero** el resto del enforcement vive en CI, no en la sesión. |
| **Skills = procedimientos empaquetados** | ✅ | 6 skills propios (`/costear-commit`, `-pr`, `-adr`, `-bitacora`, `-issue`, `-review`), con `npm run skills:sync` que los propaga a los 3 repos. `manual-skills-equipo.md`. |
| **Verificar corridas sin supervisión** | ✅ Fuerte | Cultura explícita: REV-01 "verificado se dice CÓMO", REV-06 "preguntá cómo", GR-08/GR-09 sobre no confiar en el resumen ni en herramientas propias. El CI mide *qué* tests corren (`check:tests-base`, `check-feature-tests`), no cuántos. Guardas de auto-etiquetado que cuentan `it(`/`expect(` reales. |
| **GitHub Actions** | ✅ Fuerte | Pipeline propio: `auto-merge.yml` (verifica los checks él mismo → funciona en repos privados del plan Free sin branch protection), `auto-etiquetar.yml`, `desbloquear.yml`, `metricas.yml`, `post-deploy-smoke.yml` / `playwright.yml`. |
| **Modos de permiso** | ❌ | No hay `permissions` declaradas en ningún `settings.json`. Cada sesión re-pide npm/git/docker. |
| **Rutinas / headless** | 🟡 | Solo cron de BullMQ (nightly-learning). Nada de rutinas de Claude Code ni `claude -p` para tareas de repo. |
| **Plugins** | ❌ | Los 6 skills + `briefing.mjs` + rules se copian a mano con `skills:sync` en vez de empaquetarse como plugin instalable con versión y changelog. |
| **GitHub Action de Claude Code / code review administrado** | ❌ | No existe. `auto-merge` entra sin reviews requeridos; la única mirada es la etiqueta que pone Santiago. |

### 1.2 Deuda concreta encontrada

| # | Problema | Impacto |
|---|---|---|
| D-01 | **`C:\Users\giuli\Documents\CosteAR\.claude` está contaminado**: 25 skills genéricos (`3d-web-experience`, `canvas-design`, `senior-*`, `ui-ux-pro-max`, `web-design-guidelines`…) + 12 agentes genéricos (`backend-architect`, `security-auditor`…) sin relación con CosteAR. | Cualquier sesión abierta desde la carpeta contenedora (como varias de las de esta semana) hereda 37 piezas de ruido y **ninguna** del setup disciplinado por repo. Gasta contexto y puede disparar skills equivocadas. |
| D-02 | **Worktree stale committeado**: `CosteAR-backend/.claude/worktrees/feat-vault-qa/` — con su propio `.env` (¡secretos!), `package-lock.json`, `Dockerfile`, `railway.toml`. Es la feature del RAG Q&A. | Secretos en un path versionado; confusión sobre cuál es el árbol real; peso muerto en el repo. |
| D-03 | `.agents/AGENTS.md` (2026-07-09) y `.superpowers/brainstorm/` en la carpeta contenedora. | Restos de experimentos; ruido. |
| D-04 | `settings.local.json` + `scheduled_tasks.lock` + `launch.json` en la raíz contenedora, sin `settings.json` versionado. | Config local no reproducible; nadie sabe qué está activo. |
| D-05 | El enforcement casi entero vive en CI, no en hooks de sesión. GR-08 ("98 tests verdes y el flujo roto") se cubrió con E2E en CI pero **nada frena en la sesión** que se toque el motor sin correr los fixtures. | El curso es explícito: un hook *bloquea*, una instrucción *"generalmente se sigue"*. Hay un hueco entre "el agente decidió no correr los fixtures" y "el CI lo agarra 20 min después". |

## 2. Qué falta sumar

### 2.1 Plugin del equipo (`costear-devkit`)

Empaquetar en un plugin instalable lo que hoy se copia a mano:
- Los 6 skills (`costear-*`).
- El hook `SessionStart` → `briefing.mjs` (el script es idéntico en los 3 repos; hoy si cambia hay
  que cambiarlo en tres lugares — el propio CLAUDE.md lo dice).
- Hooks nuevos de verificación (§2.2).
- Opcional: agentes propios (un `costear-reviewer` afinado a las convenciones, un
  `costear-adr-writer`).

**Beneficio:** una instalación (`/plugin install costear-devkit@marketplace`), versión + changelog,
y `skills:sync` desaparece. **Riesgo del modelo plugin (del curso):** un plugin corre con tus
privilegios — hay que leer el `SKILL.md` antes de instalar. Se mitiga porque es un plugin propio
en un repo propio (`Coste-AR/costear-devkit`), revisado por el equipo, no de un marketplace
público.

### 2.2 Hooks de verificación real (bloquean en la sesión)

| Hook | Evento | Qué hace |
|---|---|---|
| `pre-motor-costeo` | `PreToolUse` (Edit/Write sobre `src/domain/**`, `prisma/**`) | Advierte in-situ que ese cambio exige correr los fixtures de "Piezas mecánicas de precisión" + los 3 casos de ITCS antes de decir "listo" (DOM-05). No bloquea el edit; sí deja un recordatorio que el modelo no puede ignorar. |
| `pre-secreto` | `PreToolUse` (Write/Edit) | Bloquea si el contenido matchea patrones de secreto (claves, tokens, `-----BEGIN`) fuera de `.env.example`. Cierra CLI-01 en la sesión, no solo en review. |
| `stop-verificacion` | `Stop` | Si en la sesión se tocó `src/` o `prisma/` y no se corrió `lint` + `typecheck`, lo dice antes de terminar. |
| `pre-push-guard` | `PreToolUse` (Bash `git push`) | Bloquea push directo a `dev`/`staging`/`main` (GIT-01) — hoy lo bloquea GitHub, pero el hook evita el viaje. |

Van en el plugin, scoped por repo donde haga falta.

### 2.3 `permissions` en `settings.json`

Allowlist por repo de lo que es seguro sin preguntar: `npm run *`, `git status/log/diff/branch`,
`docker compose ps/logs`, `gh pr view/list`. Baja fricción sin abrir la mano (nada de `rm -rf`,
`git push`, `npm publish` en la lista). Se versiona en cada repo.

### 2.4 Claude Code GitHub Action — review que comenta, no bloquea

`anthropics/claude-code-action@v1` en los 3 repos, disparado en `pull_request`:
- Revisa el diff **y los ADR** contra las convenciones (`CLAUDE.md`, `.claude/rules/`).
- Comenta; **no** agrega un check requerido (el `auto-merge` sigue mandando).
- Es exactamente lo que piden REV-05 ("discutir los ADR es la forma de revisar") y REV-06, con
  una segunda mirada barata que hoy no existe.
- Costo: corre en el runner de Actions, consume plan de Claude; se puede limitar a PRs que tocan
  `src/`, `prisma/` o `docs/adr/`.

### 2.5 Rutinas en la nube

Candidatas (del curso: automatizar tareas recurrentes que corren con el laptop cerrado):
- **Aviso semanal "cuántos commits le faltan a `main`"** — pendiente #4 de la bitácora del
  04-09; hoy depende de que alguien se acuerde.
- **Chequeo de bóveda desactualizada** — cruza el último commit de `costear-knowledge-base` con la
  fecha del último reindex; avisa si hay drift (se vuelve innecesario cuando el loop del RAG
  cierre, pero sirve de red hasta entonces).
- **Triage de issues sin `codex`** — la bitácora del 04-09 encontró 12 issues fuera del circuito
  (ningún agente los puede tomar). Una rutina semanal que los liste y pida decisión.
- **El pipeline nocturno de aprendizaje del RAG** (ver spec del RAG, F1-14) — es el caso de uso
  estrella de una rutina + agente headless.

### 2.6 Limpieza (deuda D-01..D-04)

- **D-01:** decidir con el equipo — o se borra el `.claude` de la carpeta contenedora, o se mueve
  a un `~/.claude/` global explícito y curado (solo lo que el equipo realmente usa), o se agrega
  un `.claude/settings.json` en la raíz que desactive el descubrimiento hacia arriba. Recomendado:
  **borrarlo**; el setup vive en cada repo (y pronto en el plugin).
- **D-02:** `git rm -r CosteAR-backend/.claude/worktrees/` + agregar `.claude/worktrees/` al
  `.gitignore` + **rotar los secretos** del `.env` que quedó ahí (asumir comprometidos).
- **D-03:** borrar `.agents/` y `.superpowers/` de la carpeta contenedora.
- **D-04:** versionar un `settings.json` mínimo en la raíz o documentarlo como "no usar la carpeta
  contenedora para sesiones — abrir siempre en un repo".

## 3. Plan de implementación (issues)

Repo destino: **`CosteAR-admin`** para lo de proceso/plugin; cada repo para su `settings.json` y
sus hooks.

### Tanda O-1 — limpieza y base (rápida, sin riesgo)

| # | Issue | Repo |
|---|---|---|
| O1-01 | `git rm` del worktree stale + `.gitignore` + rotar secretos del `.env` filtrado | backend |
| O1-02 | Limpiar `.claude`/`.agents`/`.superpowers` de la carpeta contenedora + doc "abrí sesiones en un repo, no en la carpeta madre" | (contenedora) |
| O1-03 | `permissions` allowlist en `settings.json` de los 3 repos | c/repo |
| O1-04 | `fewer-permission-prompts`: escanear transcripts y afinar el allowlist con datos | c/repo |

### Tanda O-2 — plugin del equipo

| # | Issue | Repo |
|---|---|---|
| O2-01 | Crear `Coste-AR/costear-devkit` con los 6 skills + el hook `briefing` (fuente única) | nuevo repo |
| O2-02 | Marketplace interno (`costear-devkit` como `.claude-plugin/marketplace.json`) + instrucciones de instalación | nuevo repo |
| O2-03 | Migrar los 3 repos a instalar el plugin; eliminar `skills:sync` y las copias | c/repo |
| O2-04 | Changelog + versionado del plugin; regla en `AGENTS.md`: "leé el SKILL.md antes de bumpear" | nuevo repo |

### Tanda O-3 — hooks de verificación

| # | Issue | Repo |
|---|---|---|
| O3-01 | Hook `pre-secreto` (PreToolUse) | plugin |
| O3-02 | Hook `stop-verificacion` (Stop) — lint+typecheck si se tocó `src/` | plugin |
| O3-03 | Hook `pre-motor-costeo` (PreToolUse sobre `src/domain/`, `prisma/`) — recordatorio de fixtures | plugin (scoped backend) |
| O3-04 | Hook `pre-push-guard` (PreToolUse Bash) | plugin |

### Tanda O-4 — CI y rutinas

| # | Issue | Repo |
|---|---|---|
| O4-01 | `claude-code-action@v1` de review (comenta, no bloquea) en los 3 repos | c/repo |
| O4-02 | Rutina: aviso semanal de "commits sin promover a `main`" | admin |
| O4-03 | Rutina: triage semanal de issues sin `codex` | admin |
| O4-04 | Rutina: chequeo de drift de la bóveda (red hasta que cierre el loop del RAG) | admin |

## 4. Cómo nos organizamos con todo este contenido (la parte de "mejorar cómo nos organizamos")

Regla propuesta para `AGENTS.md` / `CLAUDE.md` (un solo lugar, referenciado):

1. **El setup de Claude Code es código**: vive en `costear-devkit` (plugin), versionado, con
   changelog. No se edita a mano en un repo salvo su `settings.json` de permisos y sus hooks
   scoped.
2. **Una pieza, un tipo**: procedimiento repetido → skill. Regla que debe bloquear → hook. Dato
   que las skills necesitan → MCP. Lo más común para el humano → slash command. (Es el criterio
   del curso; hoy casi todo es skill o CI.)
3. **Nada se descubre "hacia arriba"**: las sesiones se abren dentro de un repo. La carpeta
   `Documents/CosteAR/` no tiene `.claude` propio.
4. **Antes de instalar cualquier plugin/skill de afuera**: leer el `SKILL.md`/`hooks` completo —
   corre con tus privilegios. Los de `costear-devkit` los revisa el equipo en PR como cualquier
   código.
5. **El registro de cambios del setup** vive junto al del `CLAUDE.md` (misma convención: fecha,
   qué cambió, fuente).

## 5. Referencias

- Claude Code plugins (skills + hooks + agentes + MCP en una unidad instalable):
  https://docs.anthropic.com/en/docs/claude-code/plugins
- Guía de plugins para distribución en equipo:
  https://hidekazu-konishi.com/entry/claude_code_plugins_complete_guide.html
- Hooks como guardarraíles (PreToolUse que bloquea `rm`, `curl | sh`, escrituras fuera del repo):
  https://docs.anthropic.com/en/docs/claude-code/hooks
- `anthropics/claude-code-action@v1` (review con shell vivo, no comentario estático):
  https://github.com/anthropics/claude-code-action
- Headless / `claude -p` / Agent SDK para automatización:
  https://docs.anthropic.com/en/docs/claude-code/sdk
- Rutinas (automatización en la nube con el laptop cerrado): documentación de Claude Code /
  Routines.
