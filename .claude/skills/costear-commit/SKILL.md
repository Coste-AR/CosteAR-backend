---
name: costear-commit
description: >
  Crea commits atómicos con formato Conventional Commits en cualquier repo de CosteAR:
  parte los cambios staged por concepto, valida el formato y commitea cada grupo por separado.
  Trigger: "commit", "commitear", "hacer commit", "conventional commit", "qué tipo de commit va",
  "commits atomicos", "guardar los cambios", o cualquier pedido de commitear lo que está staged.
---

# CosteAR — Commit atómico

Mira los cambios staged (o los no staged si no hay nada en el índice), los agrupa por concepto,
propone un mensaje convencional por grupo y commitea cada uno por separado.

**Ejecuta directamente.** No pide confirmación salvo que haya que partir un archivo por hunks.

---

## La regla de atomicidad

**Un commit = un cambio lógico = un `tipo(scope)`.**

Hay que **partir** cuando el diff:

- toca scopes distintos (archivos de `costeo` + archivos de `auth`)
- mezcla tipos (un `feat` + un `fix` sin relación)
- mezcla código con cambios de formato o lint que no vienen al caso
- arrastra un lockfile o archivo generado ajeno al cambio

Puede quedar en **un** commit cuando todos los archivos sirven al mismo cambio lógico, aunque
sean varios: un service + su controller + su DTO del mismo endpoint, o una feature + sus tests.

---

## Formato

```
<tipo>(<scope>): <descripción en imperativo>

[cuerpo opcional]
```

Validación (la misma que aplica `commitlint` en el hook `commit-msg`):

```
^(build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test)(\([a-z0-9._-]+\))?!?: .+
```

| Tipo | Cuándo |
| --- | --- |
| `feat` | Funcionalidad o endpoint nuevo |
| `fix` | Corrección de un bug |
| `refactor` | Reestructurar sin cambiar comportamiento |
| `docs` | Documentación, comentarios, ADRs |
| `test` | Solo tests |
| `chore` | Tooling, dependencias, configuración |
| `style` | Formato o lint, sin cambio de lógica |
| `perf` | Rendimiento |
| `build` | Sistema de build |
| `ci` | Workflows de GitHub Actions |
| `revert` | Revierte un commit anterior |

**Scope:** se deduce de las rutas de los archivos del diff.

| Repo | Scopes típicos |
| --- | --- |
| backend | `costeo`, `auth`, `prisma`, `trazabilidad`, `vault`, `workers`, `config`, `ci` |
| frontend | `costeo`, `onboarding`, `auth`, `dashboard`, `trazabilidad`, `ui`, `router`, `api-client`, `ci` |
| admin | `admin`, `bitacora`, `ui`, `router`, `ci`, `skills` |

**Descripción:** imperativo ("agregar", no "agregué"), sin punto final. Se puede escribir en
español — la config desactiva `subject-case` a propósito.

---

## Pasos

```bash
# 1. Ver el estado
git status --porcelain
git diff --cached --stat
```

Si no hay nada staged, mirar los no staged y avisar que se van a agrupar esos.

```bash
# 2. Leer el diff completo y agrupar por concepto
git diff --cached
```

```bash
# 3. Por cada grupo: dejar staged SOLO ese grupo
git restore --staged .
git add <archivos del grupo>

# 4. Commitear
git commit -m "<tipo>(<scope>): <descripción>"

# 5. Repetir 3-4 hasta que no quede nada
git status --porcelain
```

Si un **mismo archivo** mezcla dos conceptos sin relación, usar `git add -p` para stagear solo
los hunks del grupo actual. Avisar al usuario cuando pase esto.

---

## Errores a evitar

- ❌ `git commit -m "cambios"` — no es convencional, el hook lo rechaza
- ❌ `git commit -m "feat: add stuff"` — vago y sin scope
- ❌ `WIP` — terminá el pedazo o usá `git stash`
- ❌ Mezclar tres cambios sin relación en un commit
- ✅ `feat(costeo): agregar cálculo de producción equivalente`
- ✅ `fix(prisma): tratar P2002 como 409 en vez de 500`

---

## Si falla el hook

```bash
npm run lint
npm run typecheck
```

Arreglar lo que marcó, volver a stagear y commitear con el mismo mensaje.

> **Nunca uses `--no-verify` para saltear el hook.** Si te frena, tiene razón. Está en
> `CLAUDE.md` como regla de oro.

---

## Gotchas conocidos

- El hook `pre-commit` corre el **typecheck completo** del repo, no solo de los archivos tocados.
  Si el proyecto ya venía con un error de tipos previo, el commit se va a bloquear aunque tu
  cambio esté bien — avisale al usuario en vez de saltear el hook.
- En el **backend**, si el diff toca `prisma/schema.prisma`, correr `npx prisma generate` antes
  del typecheck o va a tirar errores falsos.
- Los archivos generados (`dist/`, `tsconfig.tsbuildinfo`) no se commitean: verificá que estén
  en `.gitignore` antes de agregarlos por error.
