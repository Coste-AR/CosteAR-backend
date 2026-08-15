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

# 2. Abrir el PR contra dev
gh pr create --base dev \
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

## `Closes` vs `part of`

- **`Closes #N`** — solo si el PR cierra el issue **entero**.
- **`part of #N`** — si quedan gaps reales. Cerrar un issue a medias esconde trabajo pendiente,
  y con un cliente esperando eso se paga caro.

---

## Después del merge

```bash
git checkout dev && git pull
git branch -d <tipo>/<slug>
```

Y correr **`/costear-bitacora`** para registrar la sesión.

---

## Gotchas conocidos

- **`main` y `staging` están protegidos** en backend y frontend: exigen PR y **el CI en verde**.
  `dev` también. Si `gh pr merge` falla por los checks, no es un error de la skill.
- **El review NO bloquea el merge** (decisión del equipo del 15-08-2026: con 4 personas, exigir
  aprobación trababa el trabajo). Sigue siendo parte del proceso, pero como práctica: **pedile
  review a alguien antes de mergear algo que toque lógica de negocio o plata del cliente.**
  Nadie te lo va a impedir — por eso depende de vos.
- **`CosteAR-admin` es privado y no tiene protección forzada** (limitación del plan Free de
  GitHub). Las reglas valen igual, por acuerdo.
- El CI del backend tiene **dos jobs** (`build-and-test` e `integration-tests`) y los dos son
  obligatorios; el de integración tarda más porque levanta un Postgres real.
- Si `gh pr create` no encuentra el issue, verificá que exista antes de inventar el número.
