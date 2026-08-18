# CosteAR — Backend · reglas del repo

> Este archivo lo lee Claude Code automáticamente al arrancar cada sesión en este repo.
> Es el criterio con el que se juzga si una decisión es correcta — no es documentación del proyecto.
>
> **Estas reglas tienen prioridad sobre lo que diga un issue.** Si un issue las contradice, gana la regla y se avisa.
>
> Formato: cada regla tiene **ID** y **fuente/fecha**. Las marcadas `⛔ SUPERADA` ya no aplican; quedan para trazabilidad.

---

## 0. Reglas de oro

Si solo leés una sección, que sea esta.

1. **Ante la duda, frená y preguntá.** Nunca elijas por el usuario cuando hay ambigüedad real.
2. **Verificá antes de afirmar.** No digas que algo "está mergeado" o "es solo reformateo" sin haberlo mirado.
3. **No amplíes el scope de lo pedido.** Si el trabajo crece, avisá **antes** de crecerlo.
4. **Nada irreversible sin OK explícito:** migraciones, `push`, PRs, merges, config de infra.
5. **Los issues son referencia, no especificación.**
6. **Nunca `--no-verify`.** Si un hook te frena, el hook tiene razón.

---

## 1. Contexto del proyecto

CosteAR es un SaaS de costeo para profesionales de costos en PyMEs. Este repo es la **API**.

**Desde agosto 2026 hay un cliente real en producción.** Eso cambia el estándar: un número mal
calculado no es un bug, es una decisión de negocio equivocada del cliente. La matemática del
motor de costeo es sagrada — ver §5.

| Repo | Qué es | Visibilidad |
|---|---|---|
| `Coste-AR/CosteAR-backend` | Esta API | pública |
| `Coste-AR/CosteAR-frontend` | SPA del producto | pública |
| `Coste-AR/CosteAR-admin` | Panel interno + **bitácora del desarrollo** | privada |
| `Coste-AR/costear-knowledge-base` | Bóveda que alimenta el RAG | privada |

---

## 2. Stack y comandos reales

Node 22 · TypeScript strict · Prisma + PostgreSQL · Vitest · **npm** (no pnpm, no yarn).

```bash
npm run dev                 # servidor con watch
npm run lint                # eslint src tests
npm run typecheck           # tsc --noEmit
npm test                    # vitest run
npm run test:integration    # necesita Postgres levantado (docker-compose up -d)
npm run build               # prisma generate && tsc
npm run prisma:migrate      # migraciones en dev
npm run db:setup            # migrate-deploy + apply-rls
```

|ID|Regla|Fuente|
|---|---|---|
|**CMD-01**|**`npm` siempre.** Nunca mezclar con pnpm o yarn — hay un solo `package-lock.json`.|Equipo|
|**CMD-02**|**Al bajar una rama con cambios en `prisma/schema.prisma`, correr `npx prisma generate` antes de nada.** Sin eso `tsc` tira errores falsos que no existen (nos pasó con el PR #54).|Santiago, 08-2026|
|**CMD-03**|Los tests de integración necesitan Postgres real. Si no hay Docker levantado, decilo — no los marques como "pasan".|Equipo|

---

## 3. Ramas, commits y PRs

### Ramas

```
feature-branch → dev → staging → main
```

|ID|Regla|
|---|---|
|**GIT-01**|**Nunca push directo a `main`, `staging` ni `dev`.** Todo entra por PR. GitHub lo bloquea.|
|**GIT-02**|Las ramas salen de **`dev`**, nunca de `main`.|
|**GIT-03**|Nombre: `<tipo>/<slug-corto>` — solo `a-z0-9-`, máximo 40 caracteres. Ej: `feat/costeo-por-proceso`, `fix/itcs-ponderaciones`.|
|**GIT-04**|`main` solo acepta PRs desde `staging`. `staging` solo desde `dev`. No se saltean pasos.|
|**GIT-05**|Ninguna rama se mergea con el CI en rojo.|

### Commits

```
<tipo>(<scope>): <descripción en imperativo>
```

Tipos: `feat` · `fix` · `chore` · `docs` · `refactor` · `test` · `ci` · `build` · `perf` · `style` · `revert`
Scopes típicos de este repo: `costeo`, `auth`, `prisma`, `trazabilidad`, `vault`, `workers`, `config`, `ci`.

|ID|Regla|
|---|---|
|**COM-01**|**Un commit = un cambio lógico.** Si tocaste dos cosas sin relación, son dos commits. Usá `git add -p` si hace falta.|
|**COM-02**|El mensaje lo valida `commitlint` en el hook `commit-msg`. Nunca `WIP` ni "cambios varios".|
|**COM-03**|Se puede escribir en español; la config desactiva `subject-case` a propósito.|

Usá `/costear-commit` para que se parta y se escriba solo.

### Pull Requests

Se abren con `/costear-pr`. La plantilla de `.github/pull_request_template.md` se precarga sola.

|ID|Regla|
|---|---|
|**PR-01**|**`Closes #N`** solo si el PR cierra el issue **entero**. Si quedan gaps reales, `part of #N`.|
|**PR-02**|Antes de pedir review: tests, lint y typecheck en verde localmente.|
|**PR-03**|PR gigante = PR que no se revisa. Si no lo describís en 3 bullets, es más de un PR.|

---

## 4. Decisiones y trazabilidad

|ID|Regla|
|---|---|
|**DOC-01**|**Toda decisión técnica no obvia va a un ADR**: `docs/adr/NNNN-slug.md`. Se crea con `/costear-adr` y se revisa en el mismo PR que la implementa.|
|**DOC-02**|`DECISIONES.md` es **registro histórico** de la implementación de Trazabilidad Total v1. **No agregar nada nuevo ahí** — va a `docs/adr/`.|
|**DOC-03**|Al cerrar una sesión de trabajo, correr `/costear-bitacora`: escribe la entrada en `CosteAR-admin/bitacora/` para que el equipo no técnico sepa qué pasó.|
|**DOC-04**|Los diseños largos previos a implementar siguen yendo a `docs/plans/YYYY-MM-DD-slug.md`, como ya se venía haciendo.|

---

## 5. Reglas duras del dominio (no negociables)

Vienen de la especificación de Trazabilidad Total v1 y de la auditoría del motor de cálculo.

|ID|Regla|
|---|---|
|**DOM-01**|**Nada se pisa.** Los valores de costos se **versionan** (append-only). Borrado = lógico. Jamás un `DELETE` o `UPDATE` destructivo sobre datos ya cargados.|
|**DOM-02**|**Toda mutación escribe su entrada de bitácora en la misma transacción** (rollback conjunto).|
|**DOM-03**|Timestamps del **servidor**, en `timestamptz`. Nunca la hora del cliente.|
|**DOM-04**|**Ningún 500 crudo al usuario.** Errores de cálculo o validación → 422 con `{code, message, field}` en español accionable.|
|**DOM-05**|**Regresión cero en la matemática.** Los fixtures del caso "Piezas mecánicas de precisión" y los tres casos de ITCS de la cátedra tienen que seguir dando exactamente lo mismo después de cualquier cambio en el motor.|
|**DOM-06**|Migraciones **siempre aditivas** (`CREATE TABLE`, `ALTER ADD COLUMN`). Nada de `DROP` sobre tablas con datos.|
|**DOM-07**|El aislamiento entre empresas depende de **RLS en Postgres**, no de TypeScript. Un test con Prisma mockeado no prueba aislamiento — por eso existe la suite de integración con un rol sin `BYPASSRLS`.|

---

## 5.bis Datos de clientes en repositorios públicos

`CosteAR-backend` y `CosteAR-frontend` son **públicos**. `CosteAR-admin` es privado.

|ID|Regla|
|---|---|
|**CLI-01**|**Los datos de un cliente no entran a un repositorio público.** Ni su nombre, ni su localidad, ni sus números reales — no en tests, no en seeds, no en comentarios, no en ejemplos, no en cuerpos de PR ni en mensajes de commit.|
|**CLI-02**|Un fixture que necesita números realistas usa **datos ficticios** que ejerciten la misma matemática. El caso real, si hace falta conservarlo, va a `CosteAR-admin` (privado).|
|**CLI-03**|Antes de abrir un PR que toque un vertical de un cliente: `git grep -in "<nombre del cliente>"`. Si devuelve algo, no se abre.|
|**CLI-04**|Esto incluye la estructura económica: costo unitario, punto de equilibrio, precio de venta, márgenes y escala. **Que un competidor pueda leer el margen de un productor es un problema para él, no para nosotros.**|

> **Ya pasó** (18-08-2026): se subió la estructura de costos completa de un cliente, con su nombre
> al lado, a un repositorio público. Se anonimizó, pero **el historial de git es permanente**.
> Lo barato es no escribirlo; una vez publicado, ya no hay vuelta atrás completa.

## 6. Guardarraíles — antipatrones ya observados

|ID|Antipatrón|Qué hacer en su lugar|
|---|---|---|
|**GR-01**|Atribuir decisiones que el usuario no tomó|Si un plan dice "decidido", verificá que efectivamente lo haya decidido él|
|**GR-02**|Bundlear scope de más|Avisá **antes** de que el plan crezca más allá de lo pedido|
|**GR-03**|Afirmar sin verificar ("es solo reformateo")|Mirá el diff crudo antes de aprobar o descartar|
|**GR-04**|Confirmar tu propio resumen del repo|Contrastá con `git log origin/dev` o con los PRs reales|
|**GR-05**|Razonar hacia el permiso|**La ausencia de evidencia no es evidencia de permiso.** Si no encontrás la fuente, decí "no la encontré"|
|**GR-06**|Resolver una ambigüedad del ticket en silencio|Toda ambigüedad se **marca como pregunta abierta**|
|**GR-07**|Pisar el scope de otro issue|Andamio mínimo + `TODO`, y avisá|
|**GR-08**|Confiar en tests unitarios para validar un flujo|**Caso real: 98 tests verdes y el flujo roto en dos lugares.** Ningún cambio de flujo se pushea sin haberlo probado de verdad|

---

## 7. Registro de cambios de este archivo

|Fecha|Qué cambió|Fuente|
|---|---|---|
|2026-08-15|Creación. Reglas destiladas del repo `asomelab/de-wall`, de la spec de Trazabilidad Total v1 y de la auditoría del motor.|Santiago|
