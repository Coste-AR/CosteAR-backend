---
name: costear-bitacora
description: >
  Registra la sesión de trabajo en la bitácora central de CosteAR (repo CosteAR-admin):
  lee el git log y los PRs reales, redacta la entrada en castellano para el equipo no técnico,
  la guarda en bitacora/sesiones/ y actualiza el índice.
  Trigger: "bitacora", "bitácora", "registrar la sesión", "documentar lo que hicimos",
  "cerrar la sesión", "anotar en la bitacora", "trazabilidad", o al terminar una tanda de trabajo.
---

# CosteAR — Bitácora de desarrollo

Registra qué se hizo en esta sesión de trabajo, en la bitácora central que vive en el repo
**`CosteAR-admin`**. Funciona desde cualquiera de los repos de código.

Esta es la memoria del equipo frente al cliente: dentro de seis meses tiene que poder
responderse *qué se cambió, cuándo y por qué* sin depender de la memoria de nadie.

**Ejecuta directamente**, pero **muestra el borrador antes de commitear**.

---

## Paso 1 — Ubicar el repo de admin

La bitácora vive en otro repo, así que primero hay que encontrarlo. En este orden:

```bash
# 1. Variable de entorno
echo "$COSTEAR_ADMIN_PATH"

# 2. Config local de git (por máquina, no se commitea)
git config --get costear.adminPath

# 3. Ubicaciones habituales relativas al repo actual
ls -d ../../costear-admin/CosteAR-admin 2>/dev/null
ls -d ../CosteAR-admin 2>/dev/null
ls -d ../../CosteAR-admin 2>/dev/null
```

Si no aparece, **preguntarle la ruta al usuario** y ofrecerle guardarla para las próximas veces:

```bash
git config costear.adminPath "<ruta absoluta>"
```

> `git config` sin `--global` guarda en `.git/config`, que **no se commitea**. Así cada socio
> tiene su propia ruta sin ensuciar el repo.

Verificar que la ruta es la correcta antes de escribir nada:

```bash
ls "<ruta>/bitacora/INDICE.md"
```

---

## Paso 2 — Reunir los hechos reales

**No escribas de memoria ni de lo que creés que se hizo. Leé el repo.**

```bash
# Repo y rama actuales
basename "$(git rev-parse --show-toplevel)"
git branch --show-current

# Commits de esta rama respecto de dev
git log origin/dev..HEAD --format="%h %s"

# Si ya se mergeó, los commits del día
git log --since="1 day ago" --format="%h %s" --no-merges

# PRs relacionados
gh pr list --state all --head "$(git branch --show-current)" --json number,title,url,state
gh pr view --json number,title,url,state,body 2>/dev/null

# ADRs nuevos en esta tanda
git log origin/dev..HEAD --name-only --format="" -- docs/adr/ | sort -u
```

Buscar también la última entrada de la bitácora para no repetir lo ya registrado:

```bash
ls "<admin>/bitacora/sesiones/" | sort | tail -3
```

---

## Paso 3 — Redactar la entrada

Archivo: `<admin>/bitacora/sesiones/AAAA-MM-DD-<repo>-<slug>.md`

Donde `<repo>` es `backend` · `frontend` · `admin` · `knowledge-base` · `todos`.

```markdown
# AAAA-MM-DD — <Título en una frase, en castellano>

- **Repo(s):** backend
- **Rama:** `feat/costeo-por-proceso`
- **PRs:** [#57](url)
- **ADRs:** [backend#0003](url) — o `—`
- **Estado:** mergeado a `dev` | en review | en progreso

## Qué se hizo

<!--
  Para Alan y Lauti, que no programan. En castellano llano.
  Si hay que usar un término técnico, se aclara entre paréntesis la primera vez.
  Tres a seis bullets. Qué cambió PARA EL USUARIO, no qué archivos se tocaron.
-->

-

## Por qué

<!-- El motivo. Qué problema resolvía, o de qué reunión/pedido del cliente salió. -->

## Decisiones que se tomaron sobre la marcha

<!--
  Las que no llegan a ser un ADR pero conviene dejar registradas.
  Si alguna sí ameritaba ADR, linkearlo acá.
-->

-

## Qué quedó pendiente

<!-- Con issue creado cuando corresponda. "Nada" también es una respuesta válida. -->

-

## Cómo verificarlo

<!-- Pasos concretos para que otro lo compruebe. Comandos exactos, o qué mirar en pantalla. -->

1.

## Riesgos abiertos

<!--
  Lo que podría salir mal y todavía no está cubierto.
  Si salió algo mal en esta sesión, va acá: una bitácora donde todo salió bien no le sirve a nadie.
-->

-
```

### Reglas de redacción

| Regla | Por qué |
| --- | --- |
| **Se escribe para quien no programa** | Alan y Lauti tienen que poder leerla sin traductor |
| **Todo link es real y verificado** | Una entrada sin links no sirve como trazabilidad |
| **Lo que salió mal también se escribe** | Es la parte de la que se aprende |
| **Nada de credenciales, tokens ni datos del cliente** | Aunque el repo sea privado |
| **Una entrada por sesión**, no por commit | Si no, es un `git log` con más pasos |

---

## Paso 4 — Actualizar el índice

Agregar la fila **arriba de todo** en `<admin>/bitacora/INDICE.md`:

```markdown
| AAAA-MM-DD | backend | [Título](./sesiones/AAAA-MM-DD-backend-slug.md) — resumen en una línea | [#57](url) | — |
```

---

## Paso 5 — Commitear en el repo de admin

```bash
cd "<admin>"
git add bitacora/
git commit -m "docs(bitacora): registrar sesión del AAAA-MM-DD en <repo>"
```

**No pushear sin preguntar.** Mostrar el borrador al usuario antes del commit y confirmar el push.

---

## Gotchas conocidos

- **El repo de admin puede estar en otra rama o con cambios sin commitear.** Verificá
  `git -C "<admin>" status --porcelain` antes de escribir; si hay trabajo a medias de otra cosa,
  avisá en vez de mezclarlo en el mismo commit.
- **`CosteAR-admin` es privado y no tiene protección de ramas forzada** (plan Free de GitHub).
  Eso no habilita a pushear directo a `main`: sigue siendo por PR, por acuerdo del equipo.
- **No inventes números de PR ni de issue.** Si `gh` no los devuelve, poné `—` y decilo.
- Si la sesión no produjo ningún commit, **no escribas una entrada vacía**: decile al usuario
  que no hay nada que registrar todavía.
- El repo de admin tiene su propio hook de `commit-msg`: el mensaje tiene que ser convencional
  o el commit se rechaza.
