# Guía de contribución — CosteAR Backend

Punto de partida para cualquiera que trabaje en este repo. Cubre el setup, el flujo de trabajo
del equipo de principio a fin, y las convenciones.

> Las reglas duras y resumidas están en [`CLAUDE.md`](./CLAUDE.md) — ese archivo lo lee la IA
> sola en cada sesión. Este documento es el mismo contenido explicado **para una persona**.

---

## Contexto

CosteAR es un SaaS de costeo para profesionales de costos en PyMEs. Este repo es la API.

**Desde agosto de 2026 hay un cliente real en producción.** Eso cambia el estándar de todo lo
que sigue: un número mal calculado no es un bug cosmético, es una decisión de negocio equivocada
que toma el cliente con nuestros datos.

| Repo | Qué es |
| --- | --- |
| [`CosteAR-backend`](https://github.com/Coste-AR/CosteAR-backend) | Esta API |
| [`CosteAR-frontend`](https://github.com/Coste-AR/CosteAR-frontend) | SPA del producto |
| [`CosteAR-admin`](https://github.com/Coste-AR/CosteAR-admin) | Panel interno + **bitácora del desarrollo** |
| [`costear-knowledge-base`](https://github.com/Coste-AR/costear-knowledge-base) | Bóveda que alimenta el RAG |

---

## Setup

**Prerequisitos:** Node 22 · npm · Docker (para Postgres).

```bash
git clone https://github.com/Coste-AR/CosteAR-backend.git
cd CosteAR-backend

npm install              # instala dependencias y los git hooks (husky)
cp .env.example .env     # completar con las credenciales locales

docker-compose up -d     # Postgres
npm run db:setup         # migraciones + políticas RLS
npm run dev              # http://localhost:3000
```

### Comandos

```bash
npm run dev                 # servidor con watch
npm run lint                # eslint src tests
npm run typecheck           # tsc --noEmit
npm test                    # vitest run
npm run test:integration    # necesita Postgres levantado
npm run build               # prisma generate && tsc
npm run prisma:migrate      # migraciones en desarrollo
npm run prisma:studio       # UI de la base de datos
```

> ⚠️ **Al bajar una rama con cambios en `prisma/schema.prisma`, corré `npx prisma generate`
> antes de nada.** Sin eso `tsc` tira errores que no existen. Ya nos pasó.

### Git hooks

Se instalan solos con `npm install`.

- **`pre-commit`** — `lint-staged` (eslint --fix sobre lo staged) + `typecheck` del proyecto.
  Si no compila, el commit no entra.
- **`commit-msg`** — valida el mensaje con `commitlint`.

**Nunca uses `--no-verify`.** Si un hook te frena, tiene razón: arreglá lo que marcó.

---

## El flujo de trabajo

```
issue → rama desde dev → commits atómicos → PR a dev → review → merge → bitácora
```

### 1. Issue

Todo trabajo arranca en un issue. Las plantillas están en `.github/ISSUE_TEMPLATE/`.

Un issue útil explica **por qué** hace falta, no solo qué hay que hacer, y trae criterios de
aceptación verificables.

> Los issues son **referencia, no especificación**. Si uno se contradice a sí mismo o pide algo
> raro, **frená y preguntá** — no elijas por tu cuenta y lo hornees en el schema.

### 2. Rama

```bash
git fetch origin
git checkout -b feat/costeo-por-proceso origin/dev
```

- Sale siempre de **`dev`**, nunca de `main`
- Nombre `<tipo>/<slug-corto>`: solo `a-z0-9-`, máximo 40 caracteres
- Vive **días, no semanas**. Cuanto más vieja, peor el merge

### 3. Commits

```
<tipo>(<scope>): <descripción en imperativo>
```

Tipos: `feat` · `fix` · `chore` · `docs` · `refactor` · `test` · `ci` · `build` · `perf` · `style` · `revert`
Scopes de este repo: `costeo`, `auth`, `prisma`, `trazabilidad`, `vault`, `workers`, `config`, `ci`.

**Un commit = un cambio lógico.** Si tocaste dos cosas sin relación, son dos commits — se parte
con `git add -p` si hace falta. Se puede escribir en español.

```
feat(costeo): agregar cálculo de producción equivalente
fix(prisma): tratar P2002 como 409 en vez de 500
chore(ci): fijar la versión de Node en 22
```

Atajo: `/costear-commit` lo hace solo.

### 4. Pull Request

```bash
git push -u origin feat/costeo-por-proceso
```

El PR apunta a **`dev`** y la plantilla se precarga sola. Atajo: `/costear-pr`.

Antes de pedir review: **tests, lint y typecheck en verde localmente.**

- `Closes #N` solo si cierra el issue **entero**; si no, `part of #N`
- Si no lo podés describir en 3 bullets, es más de un PR

### 5. Review

Se clasifica cada hallazgo en **CRITICAL** (bloquea) / **WARNING** (habría que arreglarlo) /
**SUGGESTION** (opcional). Atajo: `/costear-review`.

Los comentarios son sobre el trabajo, nunca sobre la persona — y se toman como información, no
como ataque.

### 6. Merge y promoción

```
feature → dev → staging → main
```

- **Nunca push directo** a `main`, `staging` ni `dev`. GitHub lo bloquea.
- `main` solo acepta PRs desde `staging`; `staging` solo desde `dev`. No se saltean pasos.
- Las tres exigen **el CI en verde**, con `enforce_admins` activo en `main` y `staging`: ni un
  administrador puede mergear con los tests o el typecheck en rojo.
- **El review no bloquea el merge** (decisión del 15-08-2026: somos cuatro y exigir la
  aprobación de otro frenaba más de lo que protegía). Cada uno puede mergear su propio PR.
  **Pedí review igual** cuando el cambio toque el motor de cálculo, una migración, plata del
  cliente, o vaya a `main`. Ahí el costo de equivocarse lo paga el cliente.

### 7. Bitácora

Al cerrar la sesión: **`/costear-bitacora`**. Registra qué se hizo en
`CosteAR-admin/bitacora/`, en castellano y para todo el equipo.

---

## Decisiones técnicas

Toda decisión no obvia va a un **ADR** en [`docs/adr/`](./docs/adr/README.md), un archivo por
decisión, creado con `/costear-adr` y revisado en el mismo PR que la implementa.

Regla práctica: **si lo pensaste más de diez minutos o lo discutiste con alguien, es un ADR.**

Los diseños largos previos a implementar siguen yendo a `docs/plans/AAAA-MM-DD-slug.md`.

> `DECISIONES.md` en la raíz es **registro histórico cerrado** de Trazabilidad Total v1.
> No se le agrega nada nuevo.

---

## Reglas duras del dominio

No son estilo: son las que evitan que el cliente tome una decisión con un número mal.

1. **Nada se pisa.** Los costos se **versionan** (append-only), el borrado es lógico. Jamás un
   `DELETE` o `UPDATE` destructivo sobre datos cargados.
2. **Toda mutación escribe su bitácora en la misma transacción** (rollback conjunto).
3. **Timestamps del servidor**, en `timestamptz`. Nunca la hora del cliente.
4. **Ningún 500 crudo al usuario.** Errores de cálculo o validación → 422 con
   `{code, message, field}` en español accionable.
5. **Regresión cero en la matemática.** Los fixtures de "Piezas mecánicas de precisión" y los
   tres casos de ITCS de la cátedra tienen que seguir dando exactamente lo mismo.
6. **Migraciones aditivas.** Nada de `DROP` sobre tablas con datos.
7. **El aislamiento entre empresas depende de RLS en Postgres**, no de TypeScript. Por eso la
   suite de integración corre con un rol sin `BYPASSRLS`: un test con Prisma mockeado confirma
   que se llamó a `findFirst` con cierto `where`, no que la base no devuelva filas del otro
   inquilino.

---

## Tu primer aporte

1. Cloná el repo y completá el setup de arriba.
2. Levantá la API y verificá que responde.
3. **Leé [`CLAUDE.md`](./CLAUDE.md) completo.** Son 10 minutos y te ahorra el 90% de los errores.
4. Tomá un issue del tablero.
5. Rama desde `dev` → commits atómicos → `/costear-pr`.
6. Esperá el review. Los CRITICAL se resuelven antes del merge.
7. Post-merge: borrá la rama local y corré `/costear-bitacora`.

---

## Lo más importante, si te llevás una sola cosa

> **Los tests unitarios no validan un flujo.**
>
> Caso real: 98 tests en verde, lint y typecheck limpios, y el flujo estaba roto en dos lugares
> distintos. **Nada que toque un flujo se pushea sin haberlo probado de verdad.**

Y su corolario: **verificá antes de afirmar.** No digas que algo "ya está mergeado" o que un
diff "es solo reformateo" sin haberlo mirado. Un `200 OK` no prueba que el efecto real ocurrió.
