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

## 0.bis La filosofía: diagnosticar, planificar, recién ahí implementar

**La forma de trabajar, no una recomendación.** Diagnosticar con números → planificar con
alternativas descartadas → recién ahí implementar, y verificar donde el trabajo va a vivir, no
donde uno está parado. Se movió el 22-08-2026 para no cargarla en cada sesión sin importar la tarea. La versión
completa —con el caso que la probó y el detalle de cada trampa— vive en
[`CosteAR-admin/docs/2026-08-22-filosofia-diagnosticar-planificar-implementar.md`](https://github.com/Coste-AR/CosteAR-admin/blob/dev/docs/2026-08-22-filosofia-diagnosticar-planificar-implementar.md)
(fuente canónica: el Second Brain de Santiago, fuera de los repos de código).

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
npm run dev                          # servidor con watch
npm run lint                         # eslint src tests
npm run typecheck                    # tsc --noEmit
npm test                             # vitest run
npm run test:integration             # necesita Postgres levantado (docker-compose up -d)
npm run build                        # prisma generate && tsc
npm run prisma:migrate <nombre>      # migraciones en dev — VER CMD-04
npm run db:setup                     # migrate-deploy + apply-rls
```

|ID|Regla|Fuente|
|---|---|---|
|**CMD-01**|**`npm` siempre.** Nunca mezclar con pnpm o yarn — hay un solo `package-lock.json`.|Equipo|
|**CMD-02**|**Al bajar una rama con cambios en `prisma/schema.prisma`, correr `npx prisma generate` antes de nada.** Sin eso `tsc` tira errores falsos que no existen (nos pasó con el PR #54).|Santiago, 08-2026|
|**CMD-03**|Los tests de integración necesitan Postgres real. Si no hay Docker levantado, decilo — no los marques como "pasan".|Equipo|
|**CMD-04**|**Nunca `npx prisma migrate dev` directo.** Siempre `npm run prisma:migrate <nombre>`. El script (`scripts/migrate-dev.mjs`) filtra automáticamente las sentencias de deriva de `vault_chunks` (issue #72) que romperían el RAG si se aplicaran. Usar el comando crudo saltea esa protección.|Giuliana, 08-2026|

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
|**PR-04**|**Todo PR nace en DRAFT.** GitHub **impide mergear un borrador**: mientras el trabajo crece, nadie lo mergea por error. Se marca `gh pr ready` cuando está listo de verdad — y se dice **«terminé de pushear»**. Entre el 20 y el 22-08 se perdieron 4 PRs de trabajo por mergear PRs que todavía estaban creciendo; en un caso, 12 minutos antes del commit que faltaba.|
|**PR-05**|**Una rama de trabajo se mergea a `dev` con SQUASH** (`gh pr merge --auto --squash`, o el botón). Un PR = un commit: `dev` se lee como una lista de cambios y deshacerlo es un `git revert` de un commit. **Las PROMOCIONES (`dev→staging`, `staging→main`) van con MERGE COMMIT, nunca squash**: el squash crea una identidad nueva y git deja de reconocer la historia compartida — el PR #125 existió solo para resolver un conflicto fantasma causado por eso. Con `--auto`, GitHub mergea cuando el CI pasa y nadie mergea a mano en el medio. *(En `CosteAR-admin` no hay auto-merge: es privado y el plan Free no lo incluye.)*|
|**PR-06**|**Después de mergear, verificar que el trabajo LLEGÓ** (`git log origin/dev`), no que el PR figura en verde. Un PR apilado mergeado contra su rama de abajo aparece como `MERGED` y el trabajo no llega. Pasó 3 veces entre el 20 y el 21-08.|
|**PR-07**|**`main` es el único que publica.** `staging` → ambiente *staging* (**pre-producción**, acá se prueba); `main` → ambiente *production* (**producción**). Promover a `staging` es probar, promover a `main` es publicar. La verificación la hace el CI: el workflow *Smoke post-deploy* consulta `/health` del ambiente que le toca a la rama y **falla si no termina sirviendo el commit mergeado**. No se anota el SHA a mano ni se mira Railway: si el job está verde, el deploy llegó.|
|**PR-08**|**Lo que cambió el 22-08 y por qué está en `docs/2026-08-22-cambios-de-flujo-y-ambientes.md`.** Leerlo antes de abrir el primer PR o tocar un ambiente: explica el flujo nuevo, el mapa de ambientes y las alternativas que ya se descartaron, para no rediscutirlas.|
|**PR-09**|**El manual del flujo está en `docs/manual-de-flujo-de-trabajo.md`.** Explica qué es un draft, por qué squash en las ramas y merge commit en las promociones, y qué pasó por no tenerlo. La web de GitHub y `gh` hacen exactamente lo mismo: usar la que resulte cómoda.|

---

## 3.bis El briefing automático y `ESTADO.md`

Al abrir cualquier sesión de Claude en este repo, un hook (`SessionStart`) corre
`.claude/hooks/briefing.mjs` e **inyecta el estado real del proyecto** antes de que nadie escriba
nada: la rama, si `origin/dev` avanzó, los PRs abiertos, los issues asignados y el contenido de
`ESTADO.md`.

|ID|Regla|
|---|---|
|**EST-01**|**`ESTADO.md` es el mensaje del orquestador**: qué se está haciendo ahora, qué **no** tocar y por qué. Se inyecta entero en cada sesión, así que vale más **corto que completo** — máximo 20 líneas, solo lo que cambia lo que alguien va a hacer hoy. Lo histórico va a `docs/`.|
|**EST-02**|**Actualizar `ESTADO.md` al abrir y al cerrar un bloque de trabajo.** Un estado viejo es peor que ninguno: enseña a ignorarlo, igual que un semáforo que siempre está en rojo.|
|**EST-03**|**El briefing nunca puede romper una sesión.** Si `git` o `gh` fallan, imprime lo que pudo y sigue. Cualquier cambio al script mantiene esa garantía, y se prueba con `node .claude/hooks/briefing.mjs`.|
|**EST-04**|**Cada línea del briefing ocupa contexto de la conversación real.** Antes de agregarle algo, la pregunta es si cambia lo que la persona va a hacer. Si no, no va.|
|**EST-05**|**Antes de commitear un cambio en `.claude/settings.json`, correr `node .claude/hooks/briefing.mjs --check-settings`.** Un `settings.json` inválido **se descarta entero**, no solo la parte mal escrita: un hook mal puesto apaga todos los demás. Y el error recién aparece al abrir una sesión nueva, que es lo único que no se puede probar desde adentro de una sesión.|

> **Por qué existe.** La trazabilidad estaba escrita en documentos, y un documento depende de que
> alguien se acuerde de leerlo — el mismo modo de fallar que el diagnóstico del 22-08 encontró en el
> flujo de PRs. Además envejece: dice qué pasó el 22 de agosto, no qué pasó ayer. Esto no reemplaza
> la documentación; la vuelve innecesaria de buscar.

---

## 4. Decisiones y trazabilidad

|ID|Regla|
|---|---|
|**DOC-01**|**Toda decisión técnica no obvia va a un ADR**: `docs/adr/NNNN-slug.md`. Se crea con `/costear-adr` y se revisa en el mismo PR que la implementa.|
|**DOC-02**|`DECISIONES.md` es **registro histórico** de la implementación de Trazabilidad Total v1. **No agregar nada nuevo ahí** — va a `docs/adr/`.|
|**DOC-03**|Al cerrar una sesión de trabajo, correr `/costear-bitacora`: escribe la entrada en `CosteAR-admin/bitacora/` para que el equipo no técnico sepa qué pasó.|
|**DOC-04**|Los diseños largos previos a implementar siguen yendo a `docs/plans/YYYY-MM-DD-slug.md`, como ya se venía haciendo.|
|**DOC-05**|**Runbook de deploy**: `docs/runbook-deploy.md`. Leerlo antes de promover cualquier rama a `staging` o `main`. Actualizarlo después de cada deploy real.|

---

## 5. Reglas duras del dominio de costeo

**DOM-01 a DOM-07** — append-only, bitácora en la misma transacción, timestamps del servidor, sin
500 crudo, regresión cero, migraciones aditivas, RLS. **Viven en
`.claude/rules/dominio-costeo.md`**: cargan solo al tocar `prisma/`, `src/domain/` o
`src/application/`, que es cuando importan. No están en este archivo para no pesar en cada sesión
que no toca el motor de costeo.

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

---

## 6.bis Cómo trabajamos juntos — el protocolo de revisión

> Esta sección va dirigida a **los dos lados**: a quien implementa y a quien revisa.
> La mitad de las reglas son obligaciones de quien escribe el código; la otra mitad, de quien lo aprueba.
>
> **Existe porque el 18-08-2026 pasaron todas las cosas que están abajo, el mismo día.**

### Lo que tiene que hacer quien implementa

|ID|Regla|Por qué|
|---|---|---|
|**REV-01**|**"Verificado" no se dice solo: se dice CÓMO.** Toda afirmación de que algo funciona viene con el comando que se corrió y su resultado.|Se dijo "verificado contra base limpia" sin haberlo hecho. El bug de orden de las migraciones lo encontró el CI, no una persona.|
|**REV-02**|**No afirmar sobre el estado del repo sin mirarlo.** Ni "está mergeado", ni "eso ya existe", ni "no hace falta tocarlo".|`anomaly-detection.ts` figuraba como huérfano, y además había una versión peor corriendo en su lugar. Nadie lo había mirado.|
|**REV-03**|**Separar lo que se decidió de lo que se sabe.** Un valor elegido para poder avanzar se marca como tal y **nunca** se presenta como dato del cliente.|La vida útil del lote son 2 años porque lo decidimos nosotros, no porque nos lo haya dicho el productor.|
|**REV-04**|**Avisarle a quien le cambió el terreno.** Si un cambio afecta la tarea de otro, se le dice: en el PR, en el issue o por fuera.|Giuli no sabía que su G-01 ya estaba en `dev`. Se descubrió de casualidad.|

### Lo que tiene que hacer quien revisa

|ID|Regla|Por qué|
|---|---|---|
|**REV-05**|**Leer los ADR, no el código.** `docs/adr/` es el lugar pensado para revisar sin ser programador: ahí está la decisión, las alternativas descartadas y el costo de cada una. **Discutirlos es la forma de revisar.**|Un PR de 800 líneas no se revisa. Un ADR de una página, sí.|
|**REV-06**|**Cuando alguien diga "verificado", preguntar cómo.** Es una pregunta de diez segundos y caza la mayoría de los errores.|Esa pregunta habría encontrado el bug de las migraciones antes que el CI.|
|**REV-07**|**No mergear el mismo día que se abre el PR.** Mínimo 24 horas, salvo que haya algo roto en producción.|La mitad de los problemas del 18-08 salieron de mergear rápido y en cadena.|
|**REV-08**|**Los PRs apilados se mergean en orden, de abajo hacia arriba.** Y después se verifica que el trabajo llegó a `dev`, no solo que el PR figura como *merged*.|Dos PRs se mergearon contra su rama base. GitHub los marcó en verde y el trabajo quedó en ramas que ya nadie miraba.|

### Sobre el conocimiento

**El conocimiento no se va con quien lo escribió: se queda escrito.** Los ADR, la bitácora de `CosteAR-admin`, los tests con nombres en castellano y las reglas de este archivo existen exactamente para eso: para que no dependan de una persona ni de su memoria.

Pero escribirlo no alcanza.

> **Lo que falta siempre es que alguien más lo lea.**

Por eso `/costear-bitacora` al cerrar una sesión (DOC-03) y el ADR en el mismo PR que lo implementa (DOC-01) no son burocracia: son el único mecanismo que tenemos para que el equipo sepa lo que el equipo ya sabe.

## 7. Registro de cambios de este archivo

|Fecha|Qué cambió|Fuente|
|---|---|---|
|2026-08-22|**0.bis sale de acá.** La filosofía (diagnosticar/planificar/implementar) cargaba en TODAS las sesiones sin importar la tarea. El resumen operativo queda inline; la versión completa vive en `CosteAR-admin/docs/2026-08-22-filosofia-diagnosticar-planificar-implementar.md` (espejo del Second Brain de Santiago, que es la fuente canónica). Se evaluó y descartó ponerla en `costear-knowledge-base`: ese repo alimenta el RAG del clasificador y mete cualquier `.md` al índice — se habría mezclado con la doctrina de costeo.|Santiago|
|2026-08-22|**Pieza 1 — DOM-01..07 se mudan a `.claude/rules/dominio-costeo.md`**, scoped a `prisma/**`, `src/domain/**` y `src/application/**`. Antes cargaban en TODAS las sesiones (297 líneas del archivo raíz, siempre en contexto); ahora cargan solo cuando el trabajo toca el motor de costeo o el schema, que es cuando importan. La filosofía (0.bis) y los datos de clientes (5.bis) NO se movieron: su riesgo no está atado a una carpeta — un commit o un PR body no son "un archivo que matchea un glob".|Santiago|
|2026-08-22|**Sección 3.bis — briefing automático de sesión** (`SessionStart` + `ESTADO.md`). El contexto deja de depender de que alguien se acuerde de leer un documento: cada sesión arranca sabiendo qué pasó, qué no tocar y por qué. Es el mismo criterio que la Fase 1 aplicó al flujo de PRs, aplicado a la documentación.|Santiago|
|2026-08-22|**PR-05 corregida y PR-09**: la regla decía "squash" a secas y era imprecisa. Las ramas de trabajo van squash; **las promociones van merge commit**, porque el squash rompe la identidad compartida entre ramas y hace conflictuar la promoción siguiente (fue la causa del PR #125). Se agrega `docs/manual-de-flujo-de-trabajo.md`, que explica el flujo entero para quien nunca usó draft ni auto-merge.|Santiago|
|2026-08-22|**Se reordenaron los ambientes**: `staging` pasa a ser **pre-producción** y `main` **producción**. Antes los dos ambientes de Railway servían la rama `staging` y `main` no deployaba a ningún lado. PR-07 reescrita y el runbook documenta cómo verificar que cada ambiente tenga su propia base — con `db:setup` en el `preDeployCommand`, una base compartida haría que cada deploy de prueba migre producción.|Santiago|
|2026-08-22|**Corrección de PR-07**: al cargar las URLs se descubrió que los ambientes `staging` y `production` sirven **la misma rama** `staging`, y que `main` no deploya a ningún lado. El runbook decía lo contrario. El smoke verifica los dos ambientes y `main` deja de dispararlo.|Santiago|
|2026-08-22|**PR-07** + `.github/workflows/post-deploy-smoke.yml` + `scripts/smoke-deploy.mjs`: el CI verifica solo que el ambiente esté sirviendo el commit que se mergeó. Cierra el paso manual «anotá el SHA» del runbook, que nunca se ejecutó y dejó tres preguntas sin responder en la auditoría del 20-08. Fase 2 del plan del §11.4.|Santiago|
|2026-08-22|**PR-04/05/06**: el PR nace en draft, se mergea con `--auto`, y después se verifica que el trabajo llegó. Reemplazan por mecanismo lo que REV-08 pedía recordar. La skill `/costear-pr` ya crea los PRs en borrador.|Santiago|
|2026-08-22|**Sección 0.bis — la filosofía: diagnosticar, planificar, recién ahí implementar.** Se escribió después de que aplicarla encontrara, en una tarde, la causa de tres días de re-trabajo: cuatro casillas de configuración apagadas, no falta de disciplina. Incluye las tres trampas que el orden evita.|Santiago|
|2026-08-21|**CMD-04** + `scripts/migrate-dev.mjs`: automatiza el filtrado de deriva de `vault_chunks` que antes se hacía a mano en cada migración (issue #72). `npm run prisma:migrate` ahora llama al script en lugar de `prisma migrate dev` directo.|Giuliana|
|2026-08-18|Secciones **5.bis** (datos de clientes en repos públicos, CLI-01 a CLI-04) y **6.bis** (protocolo de revisión, REV-01 a REV-08). Las dos salen de cosas que pasaron ese día: se publicó la estructura de costos de un betatester en un repo público, y ocho PRs se mergearon el mismo día que se abrieron.|Santiago|
|2026-08-15|Creación. Reglas destiladas del repo `asomelab/de-wall`, de la spec de Trazabilidad Total v1 y de la auditoría del motor.|Santiago|
