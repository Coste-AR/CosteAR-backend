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

> **Esta es la forma de trabajar, no una recomendación.** Vale para código, para infraestructura,
> para procesos y para cualquier problema que aparezca. Se escribió el 22-08-2026, después de que
> aplicarla encontrara en una tarde la causa de tres días de re-trabajo.

**Los tres pasos, en orden, siempre:**

| Paso | Qué significa | Qué NO es |
|---|---|---|
| **1. Diagnosticar** | Medir qué está pasando, con números y comandos reproducibles. Descartar primero lo que **no** es el problema. | No es opinar, ni suponer, ni empezar a arreglar lo primero que se ve |
| **2. Planificar** | Escribir el plan **antes** de ejecutarlo: fases independientes, con su costo y lo que cierra cada una. Y las **alternativas descartadas, con el motivo**. | No es una lista de tareas: si no dice por qué se eligió eso y no otra cosa, no es un plan |
| **3. Implementar** | Recién acá se toca algo. Y se verifica **en el entorno donde el trabajo va a vivir**, no donde uno está parado. | No es "empiezo y veo" |

**Por qué importa, con el caso que lo probó:** el 20 y 21-08 se arreglaron cinco defectos del motor
de costeo, y en el medio se perdieron horas en re-trabajo. La reacción natural era escribir otra
regla. En vez de eso se midió: **de 24 PRs en tres días, 4 no agregaron nada** — existían solo para
recuperar trabajo ya hecho. Con ese número, la causa apareció sola, y resultó ser **cuatro casillas
de configuración apagadas**, no una falta de disciplina.

**Sin el diagnóstico, se habría arreglado el problema equivocado.**

### Las tres trampas que este orden evita

1. **Arreglar el síntoma.** Los tres primeros incidentes parecían culpa de los PRs apilados. El
   cuarto fue un PR simple: el apilamiento agravaba, no causaba. Prohibir los apilados habría
   costado trabajo y no habría arreglado nada.
2. **Escribir una regla en vez de un control.** REV-08 se escribió el 18-08 por un accidente
   concreto y volvió a pasar tres veces en tres días. **Una regla que hay que recordar en el momento
   exacto no es un control: es una intención.** Si algo tiene que pasar siempre, se automatiza o se
   configura; escribirlo es el último recurso, no el primero.
3. **Verificar donde uno está parado.** Un test que pasaba en la máquina del dev no cargaba en el
   CI. Un instructivo escrito en sintaxis de bash para alguien que usa PowerShell. **Verificar es
   verificar allá, no acá.**

### Cómo se aplica en el día a día

- **Antes de escribir código para un problema nuevo:** medir primero. Un comando que devuelva un
  número vale más que un párrafo de análisis.
- **Todo diagnóstico y todo plan quedan escritos** en el documento consolidado de `CosteAR-admin`
  (`docs/`), no en un `.md` nuevo. Con las alternativas descartadas.
- **Lo que salió mal se escribe igual**, y con el mismo detalle que lo que salió bien: es de donde
  sale el diagnóstico siguiente.
- **Al terminar, se anota en la bitácora** (`/costear-bitacora`), en castellano llano.

> Si el trabajo empieza por el paso 3, en algún momento se vuelve al 1 — pero habiendo gastado el
> tiempo dos veces.

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
|**PR-05**|**Para mergear se usa `gh pr merge --auto --squash`**, no el botón a mano. GitHub mergea solo cuando el CI pasa: nadie espera mirando la pantalla y nadie mergea en el medio. *(En `CosteAR-admin` no está disponible: es privado y el plan Free no lo incluye.)*|
|**PR-06**|**Después de mergear, verificar que el trabajo LLEGÓ** (`git log origin/dev`), no que el PR figura en verde. Un PR apilado mergeado contra su rama de abajo aparece como `MERGED` y el trabajo no llega. Pasó 3 veces entre el 20 y el 21-08.|
|**PR-07**|**Mergear a `staging` es publicar al cliente, por duplicado.** Los ambientes `staging` **y** `production` de Railway tienen conectada la misma rama `staging`; `main` no deploya a ningún lado. La verificación la hace el CI: el workflow *Smoke post-deploy* consulta `/health` de **los dos** ambientes y falla si alguno no termina sirviendo el commit mergeado. No se anota el SHA a mano ni se mira Railway: si el job está verde, el deploy llegó.|

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
|2026-08-22|**Corrección de PR-07**: al cargar las URLs se descubrió que los ambientes `staging` y `production` sirven **la misma rama** `staging`, y que `main` no deploya a ningún lado. El runbook decía lo contrario. El smoke verifica los dos ambientes y `main` deja de dispararlo.|Santiago|
|2026-08-22|**PR-07** + `.github/workflows/post-deploy-smoke.yml` + `scripts/smoke-deploy.mjs`: el CI verifica solo que el ambiente esté sirviendo el commit que se mergeó. Cierra el paso manual «anotá el SHA» del runbook, que nunca se ejecutó y dejó tres preguntas sin responder en la auditoría del 20-08. Fase 2 del plan del §11.4.|Santiago|
|2026-08-22|**PR-04/05/06**: el PR nace en draft, se mergea con `--auto`, y después se verifica que el trabajo llegó. Reemplazan por mecanismo lo que REV-08 pedía recordar. La skill `/costear-pr` ya crea los PRs en borrador.|Santiago|
|2026-08-22|**Sección 0.bis — la filosofía: diagnosticar, planificar, recién ahí implementar.** Se escribió después de que aplicarla encontrara, en una tarde, la causa de tres días de re-trabajo: cuatro casillas de configuración apagadas, no falta de disciplina. Incluye las tres trampas que el orden evita.|Santiago|
|2026-08-21|**CMD-04** + `scripts/migrate-dev.mjs`: automatiza el filtrado de deriva de `vault_chunks` que antes se hacía a mano en cada migración (issue #72). `npm run prisma:migrate` ahora llama al script en lugar de `prisma migrate dev` directo.|Giuliana|
|2026-08-18|Secciones **5.bis** (datos de clientes en repos públicos, CLI-01 a CLI-04) y **6.bis** (protocolo de revisión, REV-01 a REV-08). Las dos salen de cosas que pasaron ese día: se publicó la estructura de costos de un betatester en un repo público, y ocho PRs se mergearon el mismo día que se abrieron.|Santiago|
|2026-08-15|Creación. Reglas destiladas del repo `asomelab/de-wall`, de la spec de Trazabilidad Total v1 y de la auditoría del motor.|Santiago|
