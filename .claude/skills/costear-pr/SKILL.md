---
name: costear-pr
description: >
  Abre un Pull Request en un repo de CosteAR: corre los chequeos previos, crea la rama desde
  dev si hace falta, pushea y abre el PR con la plantilla completa apuntando a la rama correcta.
  Trigger: "abrir PR", "crear PR", "hacer el PR", "pull request", "subir la rama",
  "está listo para review", o cuando la implementación terminó y hay que pedir revisión.
---

# CosteAR — Branch + Pull Request

Crea la rama con la convención del equipo, valida que todo esté en verde, la pushea y abre el
PR con la plantilla llena apuntando a **`dev`**.

**Ejecuta directamente**, pero **frena y pregunta antes de pushear** si el árbol está sucio o si
algún chequeo falla.

---

## Modelo de promoción

```
<tipo>/<slug>  →  dev  →  staging  →  main
```

| Origen | Destino | Quién lo abre |
| --- | --- | --- |
| rama de trabajo | `dev` | esta skill |
| `dev` | `staging` | promoción, la decide Santiago |
| `staging` | `main` | promoción, la decide Santiago |

**Esta skill siempre apunta a `dev`.** Las promociones a `staging` y `main` son decisión del
equipo y no se automatizan acá.

---

## Chequeos previos (todos, antes de tocar nada)

1. **Rama base correcta:** la rama actual tiene que salir de `dev`. Verificar con
   `git merge-base --is-ancestor origin/dev HEAD`. Si salió de `main`, avisar — el merge después
   va a ser un problema.
2. **Árbol limpio** o todo lo pendiente ya commiteado (usar `/costear-commit`).
3. **Tests:** `npm test`
4. **Lint:** `npm run lint` *(saltear en admin: todavía no tiene ESLint)*
5. **Typecheck:** `npm run typecheck`
6. **Backend, si tocó RLS, aislamiento o queries:** `npm run test:integration`
7. **Si tocó UI o un flujo:** preguntar explícitamente si se probó en el navegador. **No asumir
   que sí.** Un flujo roto con los tests en verde ya pasó.

Si algo falla → **se arregla primero**. Pedir review con el CI en rojo le hace perder el tiempo
a otro.

---

## Nombre de la rama

```
<tipo>/<slug-corto>
```

Solo `a-z0-9-`, máximo 40 caracteres. Tipos: `feat` · `fix` · `chore` · `docs` · `refactor` ·
`perf` · `test` · `build` · `ci`.

```bash
git fetch origin --quiet
git checkout -b <tipo>/<slug> origin/dev
```

---

## Pasos

```bash
# 1. Pushear la rama
git push -u origin <tipo>/<slug>

# 2. Abrir el PR contra dev, SIEMPRE COMO DRAFT (ver abajo por qué)
gh pr create --base dev --draft \
  --title "<tipo>(<scope>): <descripción>" \
  --body "$(cat <<'BODY'
Closes #<N>

## Qué
- ...

## Por qué
...

## Cambios
| Archivo | Cambio |
| --- | --- |
| ... | ... |

## Cómo probarlo
### Automático
- [x] lint / typecheck / tests pasan
### Manual
1. ...

## Checklist
- [ ] Issue vinculado
- [ ] Commits convencionales y atómicos
- [ ] Probado a mano
- [ ] Decisión no trivial documentada en `docs/adr/`
BODY
)"
```

El título del PR sigue la misma convención que los commits.

---

## 🎯 El PR nace en DRAFT, y por qué

**Todo PR se abre como borrador (`--draft`), sin excepción.**

No es formalidad: **GitHub impide mergear un draft**. Mientras el PR esté en borrador, nadie puede
mergearlo por error — ni siquiera queriendo.

### El problema que esto resuelve

El trabajo se pushea de a poco: se abre el PR y se le siguen agregando commits (una corrección, los
tests, el ADR). Quien mergea ve un PR abierto y en verde, y lo mergea. **Nada distingue “esto está
listo” de “esto todavía está creciendo”.**

Entre el 20 y el 22-08-2026 eso pasó **cuatro veces**: cuatro PRs se abrieron solo para recuperar
trabajo que se había quedado afuera. En un caso el merge ocurrió **12 minutos antes** del commit que
faltaba. Es el 17 % de los PRs de esos tres días — trabajo que no agregó nada.

Ya existía una regla escrita para evitarlo (REV-08, del 18-08) y volvió a pasar tres veces.
**Una regla que hay que recordar en el momento exacto no es un control: es una intención.**

### El flujo completo

```bash
# 1. Se abre en borrador y se sigue trabajando tranquilo
gh pr create --base dev --draft --title "..." --body "..."

# 2. Poné la rama al día con dev antes de marcarlo listo:
gh pr update-branch <numero>

# 3. Cuando de verdad está listo (tests, lint, typecheck, ADR si corresponde):
gh pr ready
```

**Ahí termina tu parte.** No corras `gh pr merge` — tampoco con `--auto`. Desde el 30-08-2026 el
merge lo hace `.github/workflows/auto-merge.yml`, y sólo cuando el PR tiene **todos sus checks en
verde** y **la etiqueta `auto-merge`**. La etiqueta la pone Santiago: es el juicio humano que
**reemplaza al review**, porque no hay reviews requeridos en estos repos.

> ⚠️ Este skill decía antes `gh pr merge --auto --squash`. Quedó obsoleto el 30-08-2026: el
> auto-merge nativo de GitHub sólo actúa donde hay protección de rama, y `CosteAR-admin` no la
> tiene. Por eso el workflow verifica los checks él mismo, igual en los tres repos.

**El canónico de quién hace qué es `CosteAR-os/ORQUESTACION.md`.** Si este archivo lo contradice,
manda ese y este está viejo.

### Cuándo marcar `ready`

Cuando se puedan tildar **todas**:

- [ ] Tests, lint y typecheck en verde **localmente**
- [ ] No falta ningún commit por pushear — **`git status` limpio y `git push` hecho**
- [ ] El ADR, si la decisión lo amerita, ya está en el PR
- [ ] El cuerpo del PR describe qué, por qué y cómo probarlo

Y decirlo explícitamente: **«terminé de pushear»**. El estado del PR ya lo dice, pero decirlo en voz
alta cierra el circuito.

---

## `Closes` vs `part of`

- **`Closes #N`** — solo si el PR cierra el issue **entero**.
- **`part of #N`** — si quedan gaps reales. Cerrar un issue a medias esconde trabajo pendiente,
  y con un cliente esperando eso se paga caro.

---

## Después del merge

Esto lo corrés **vos, Claude**, apenas la persona avisa que mergeó. No se lo pidas a ella: los
socios no hacen pulls a mano, y una copia local atrasada es de dónde salen las ramas fantasma.

```bash
git checkout dev && git pull
git branch -d <tipo>/<slug>
```

> La rama **remota** se borra sola: `delete_branch_on_merge` está activo en los tres repos desde el
> 22-08. Solo hay que limpiar la local.

**Y verificar que el trabajo llegó de verdad**, no que el PR figura en verde:

```bash
git log origin/dev --oneline -3        # ¿están tus commits?
```

Un PR apilado que se mergea contra su rama de abajo aparece como `MERGED` **y el trabajo no llega a
`dev`**. Pasó tres veces entre el 20 y el 21-08.

Y correr **`/costear-bitacora`** para registrar la sesión.

---

## Gotchas conocidos

- **`main` y `staging` están protegidos** en backend y frontend: exigen PR y **el CI en verde**.
  `dev` también. Si el auto-merge no entra por los checks, no es un error de la skill.
- **El review NO bloquea el merge** (decisión del equipo del 15-08-2026: con 4 personas, exigir
  aprobación trababa el trabajo). Desde el 30-08-2026 lo que ocupa su lugar es **la etiqueta
  `auto-merge`**: sin ella no entra nada, y la pone una persona. **Esa etiqueta es el review.**
- **`CosteAR-admin` es privado y no tiene protección forzada** (limitación del plan Free de
  GitHub). Las reglas valen igual, por acuerdo.
- El CI del backend tiene **dos jobs** (`build-and-test` e `integration-tests`) y los dos son
  obligatorios; el de integración tarda más porque levanta un Postgres real.
- Si `gh pr create` no encuentra el issue, verificá que exista antes de inventar el número.
