# Manual del flujo de trabajo

> Para cualquiera que trabaje en los repos de CosteAR — y para la IA que trabaje con él.
>
> Explica **qué** hacer, **por qué**, y **qué pasa si no**. Las reglas cortas y vinculantes viven
> en `CLAUDE.md`; esto es el manual que las explica.

---

## Lo primero: tu flujo de siempre está bien

Si venís haciendo esto:

```
git add .  →  git commit -m "..."  →  git push origin mi-rama  →  ir a github  →  crear PR  →  mergear
```

**Seguí haciéndolo.** Solo cambian dos momentos:

```
git add .  →  git commit  →  git push origin mi-rama  →  github  →  crear PR  →  mergear
                                                                        ↓             ↓
                                                                 elegí DRAFT     elegí SQUASH
```

### La web y la terminal hacen exactamente lo mismo

No hay ninguna diferencia técnica entre crear un PR desde github.com o desde `gh pr create`. Draft,
squash y auto-merge son botones que están en los dos lados. **Usá el que te resulte cómodo.**

Los comandos de este manual son el equivalente en terminal, por si preferís no salir de ahí — no
una obligación.

> ⚠️ Una cosa que sí está prohibida: **`git push` directo a `dev`, `staging` o `main`**. GitHub lo
> bloquea (GIT-01). A esas ramas se entra siempre por PR.

---

## Parte 1 — El PR nace en borrador

### Qué es un draft

Un PR marcado como **borrador**. GitHub le **desactiva el botón de merge**: nadie puede mergearlo,
ni queriendo.

| Dónde | Cómo se hace |
|---|---|
| **Web** | Al crear el PR, el botón verde tiene una flechita ▾ → *Create draft pull request* |
| **Terminal** | `gh pr create --base dev --draft --title "..." --body "..."` |

Cuando terminaste de verdad:

| Dónde | Cómo se hace |
|---|---|
| **Web** | Botón **Ready for review**, arriba del PR |
| **Terminal** | `gh pr ready` |

### Por qué

Cuando abrís un PR y seguís pusheando —una corrección, los tests que faltaban, el ADR— desde afuera
**no hay forma de distinguir dos situaciones muy distintas**:

- "Esto está terminado, revisalo."
- "Esto todavía está creciendo, no lo toques."

Las dos se ven igual: **PR abierto, CI en verde**. Quien pasa y quiere ayudar, mergea.

### Qué pasó por no tener esto

Entre el 20 y el 22-08-2026 se abrieron **24 PRs** en el backend. **Cuatro no agregaron nada**:
existieron solo para recuperar trabajo que ya estaba hecho y se había quedado afuera.

| PR | Se mergeó | El commit que faltaba llegó | Diferencia |
|---|---|---|---|
| #119 | 15:09:49 | 15:21:32 | **12 minutos después** |
| #122 | 16:12:25 | 18:04:01 | ~2 horas después |

Ese 17 % de los PRs fue **re-trabajo puro**.

Y el dato que decidió todo: **ya existía una regla escrita** pidiendo verificar antes de mergear
(REV-08, del 18-08). Volvió a pasar tres veces en los tres días siguientes.

> **Una regla que hay que recordar en el momento exacto no es un control: es una intención.**
>
> El draft no depende de que nadie se acuerde. GitHub no deja, y listo.

### Cuándo marcar "Ready"

Cuando puedas tildar **todas**:

- [ ] `npm test`, `npm run lint` y `npm run typecheck` en verde **en tu máquina**
- [ ] **`git status` limpio y `git push` hecho** — no falta ningún commit
- [ ] El ADR, si la decisión lo amerita, ya está en el PR
- [ ] El cuerpo del PR dice qué, por qué y cómo probarlo

Y decilo en voz alta: **«terminé de pushear»**. El estado del PR ya lo dice, pero decirlo cierra el
circuito con quien esté esperando.

---

## Parte 2 — Cómo se mergea

### Las tres formas, y qué deja cada una

Supongamos que tu rama tiene cuatro commits: `wip`, `arreglo el typo`, `ahora sí`, `falta un test`.

| Forma | Qué queda en `dev` |
|---|---|
| **Merge commit** | Los cuatro commits + uno de merge. **Cinco líneas nuevas** en el historial |
| **Squash** ⭐ | **Un solo commit**, con el título del PR |
| **Rebase** | Los cuatro, reescritos, sin commit de merge |

### Para ramas de trabajo: SQUASH

Tres razones concretas:

1. **`dev` se lee como una lista de cambios**, no como el diario de tu tarde. El que viene mañana
   entiende qué pasó leyendo diez líneas.
2. **Deshacer un PR es un `git revert` de un commit.** Con merge commit hay que revertir varios, en
   orden, y es fácil equivocarse.
3. **`git bisect`** —buscar cuál commit rompió algo— funciona mucho mejor cuando cada commit es un
   cambio completo y andando. Con `wip` en el medio, la búsqueda se ensucia.

**¿Se pierden tus commits?** No. Quedan en el PR de GitHub, visibles para siempre. Lo que cambia es
qué se ve en el historial de `dev`.

El squash lo aplica el workflow de auto-merge cuando la base es `dev`. **Nadie corre
`gh pr merge` a mano** — ver *"Nadie mergea a mano"* más abajo.

### Para promociones (`dev → staging → main`): MERGE COMMIT

**Acá NO va squash**, y el motivo es importante.

El squash crea un commit **nuevo, con otra identidad**, aunque el contenido sea idéntico. Si aplastás
una promoción, git deja de reconocer que `staging` y `dev` comparten historia — y **la próxima
promoción da conflicto sobre trabajo que ya está ahí.**

Ya pasó: el PR #120 entró como squash, y el #125 tuvo que existir **solo** para resolver ese
conflicto fantasma.

Es la misma razón por la que `git branch --merged dev` **no detecta las ramas mergeadas con squash**:
diez ramas quedaron dando vueltas en la poda del 22-08 por eso, y hubo que verificarlas PR por PR.

En la web es el botón por defecto (**Create a merge commit**), así que alcanza con no cambiarlo.

### Resumen

| De → a | Forma | Por qué |
|---|---|---|
| `mi-rama` → `dev` | **Squash** | Historial limpio, revert de un solo commit |
| `dev` → `staging` | **Merge commit** | Preserva la identidad; si no, la próxima promoción conflictúa |
| `staging` → `main` | **Merge commit** | Ídem |

---

## Parte 3 — El merge es automático. La decisión no.

**Actualizado el 30-08-2026.** Hasta esa fecha esta parte decía que el auto-merge era "opcional,
comodidad, no una regla", y que `CosteAR-admin` no podía tenerlo. Las dos cosas cambiaron.

Ahora **nadie mergea a mano**. Un PR entra cuando pasan las dos:

1. **Todos sus checks están en verde** — y cero checks *no* cuenta como verde.
2. **Alguien le puso la etiqueta `auto-merge`.**

```bash
gh pr update-branch 123                 # rama al dia con dev
gh pr ready 123                         # sale de draft
gh pr edit 123 --add-label auto-merge   # y ahi entra solo
```

**Los dos primeros los corre quien hizo el trabajo, agente incluido. El tercero no.** La etiqueta
la pone Santiago: es donde entra el juicio humano. Un agente llega hasta `ready` y avisa. El
reparto completo está en `CosteAR-os/ORQUESTACION.md`, que es el canónico.

### Por qué una etiqueta y no el verde a secas

**No hay reviews requeridos en ningún repo.** Sin ese freno, cualquier PR entraría a `dev` en
cuanto el semáforo se pusiera verde, sin que nadie lo haya mirado — y ahora quien abre la mayoría
de los PRs es un agente. **La etiqueta reemplaza al review, no es un trámite.**

El draft sigue cumpliendo su función y se lleva bien con esto: un PR en borrador **nunca** se
auto-mergea. Trabajás tranquilo, y cuando terminaste lo marcás listo.

### Por qué un workflow nuestro y no el `--auto` de GitHub

El nativo sólo actúa cuando **algo bloquea** el PR: checks requeridos por la protección de rama.
`CosteAR-admin` es privado y en plan Free no admite protección, así que ahí el nativo no gatea
nada — mergearía al instante, con el CI en rojo o sin haber corrido.

`.github/workflows/auto-merge.yml` **verifica los checks él mismo**, y por eso se comporta igual
en los tres repos. En admin es literalmente lo único que separa un merge bueno de uno en rojo.

### Lo que hace por vos sin que se lo pidas

- **Si el PR quedó atrás de su base, lo actualiza y espera.** No lo mergea. Los checks tienen que
  volver a correr sobre el código integrado con la base de *ahora*: sin eso, dos PR verdes contra
  el mismo `dev` viejo entran los dos y el segundo rompe.
- **Borra la rama** después de mergear.
- **Registra por qué no mergeó**, cuando no mergea. Está en la pestaña Actions, un grupo por PR.

> **`main` sigue siendo a mano.** Es producción y hay un cliente real del otro lado.

---

## Parte 4 — Después de mergear, verificá que llegó

```bash
git log origin/dev --oneline -3
```

**No alcanza con que el PR figure en verde.** Un PR apilado —uno que apunta a otra rama en vez de a
`dev`— se mergea contra esa rama de abajo, GitHub lo marca `MERGED` en verde, **y el trabajo no
llega a `dev`**.

Pasó tres veces entre el 20 y el 21-08.

Lo que sí se borra solo: **la rama remota**. `delete_branch_on_merge` está activo en los tres repos
desde el 22-08. La local se limpia con:

```bash
git checkout dev && git pull
git branch -d mi-rama
```

---

## Parte 5 — Y si promovés a `staging` o `main`

No hay que anotar nada ni mirar Railway. **El CI verifica solo** que el ambiente esté sirviendo el
commit que mergeaste, y **falla en rojo si no llegó**.

```
rama `staging` → ambiente "staging"     = PRE-PRODUCCIÓN (acá se prueba)
rama `main`    → ambiente "production"  = PRODUCCIÓN
```

**Mergear a `main` es publicar.** No hay ningún paso posterior que lo frene.

Para verificar un ambiente sin pushear nada: Actions → *Smoke post-deploy* → **Run workflow** → y en
*Use workflow from* elegí **`staging`** o **`main`** (no `dev`: no deploya a ningún lado, y daría un
rojo sin sentido).

---

## El flujo completo, de una

```bash
# 1. Rama nueva, siempre desde dev actualizado
git checkout dev && git pull
git checkout -b feat/lo-que-sea

# 2. Trabajás normal
git add .
git commit -m "feat(scope): lo que hiciste"
git push -u origin feat/lo-que-sea

# 3. PR en BORRADOR (o el botón ▾ → Create draft pull request en la web)
gh pr create --base dev --draft --title "feat(scope): ..." --body "..."

# 4. Seguís pusheando tranquilo: nadie te lo puede mergear en el medio
git commit -m "test(scope): el caso que faltaba"
git push

# 5. Poné la rama al día con dev
gh pr update-branch 123

# 6. Cuando terminaste de verdad (checklist de la Parte 1)
gh pr ready

# 7. Acá termina tu parte: avisás. La etiqueta `auto-merge` la pone Santiago
#    y mergea el workflow. Si sos vos quien decide, es:
#    gh pr edit 123 --add-label auto-merge

# 8. Verificar que el trabajo LLEGÓ, no que el PR está verde
git log origin/dev --oneline -3

# 9. Limpiar la rama local (la remota se borra sola)
git checkout dev && git pull
git branch -d feat/lo-que-sea
```

---

## Preguntas frecuentes

**¿Tengo que usar la terminal?**
No. Todo esto son botones en github.com. Usá lo que te resulte cómodo.

**¿Y si me olvido del draft?**
No pasa nada grave: convertí el PR a borrador con *Convert to draft* (web) o `gh pr ready --undo`.

**¿Y si mi PR ya está mergeado y me faltó un commit?**
Abrí otro PR con lo que falta. Es lo que pasó cuatro veces en agosto — el draft existe justamente
para que no vuelva a hacer falta.

**¿Puedo mergear el mismo día que abro el PR?**
Sí. **Desde el 30-08-2026 se mergea apenas está verde, al día con su base y sin conflictos.**

Hasta esa fecha REV-07 pedía esperar 24 horas, porque la mitad de los problemas del 18-08 salieron
de mergear rápido y en cadena. Esa regla se escribió cuando la única verificación era `npm test`:
las 24 horas compraban tiempo de mirada humana porque no había otra cosa.

Hoy hay otra cosa —CI obligatorio en las tres ramas, E2E en cuatro viewports, `strict`, y el merge
automático que verifica antes de tocar nada— y además **el costo se dio vuelta**: con varios
agentes trabajando en paralelo, una cola de PRs esperando 24 horas se desactualiza sola y genera
los conflictos que la espera venía a evitar.

**¿Por qué tanto cuidado con esto?**
Porque se midió. En tres días, el 17 % de los PRs no agregó nada: existieron solo para mover trabajo
que ya estaba hecho. No fue falta de disciplina — fue que **todo lo que dependía de que alguien se
acordara, falló; y todo lo que estaba automatizado, funcionó.**

---

## Dónde está el resto

| Qué | Dónde |
|---|---|
| Las reglas cortas y vinculantes | `CLAUDE.md` §3 |
| Qué cambió el 22-08 y por qué | `docs/2026-08-22-cambios-de-flujo-y-ambientes.md` |
| Cómo promover y deployar | `docs/runbook-deploy.md` |
| El diagnóstico completo con los números | `Auditorias/2026-08-20 auditoria consolidada y reparto.md`, §10 y §11 |
