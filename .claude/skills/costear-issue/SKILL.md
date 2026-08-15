---
name: costear-issue
description: >
  Convierte un pedido, un bug encontrado auditando o una idea suelta en un issue de GitHub
  bien formado en el repo correcto de CosteAR: entrevista lo que falta, elige repo y plantilla,
  busca duplicados, etiqueta y lo crea sin asignar para que un dev lo tome.
  Trigger: "crear issue", "abrir issue", "cargar un issue", "anotar esto para los devs",
  "encontré un error", "reportar un bug", "pedir una funcionalidad", "esto hay que arreglarlo",
  "esto falta", o cuando alguien describe algo pendiente que no se va a hacer ahora mismo.
---

# CosteAR — Crear issue

Convierte lo que le contás en un issue de GitHub que un dev pueda tomar sin volver a
preguntarte nada.

**Esta skill está pensada para Alan y Lauti**, que auditan el producto y detectan lo que falta.
No hace falta saber programar ni saber en qué repo va: la skill lo resuelve preguntando.

**No ejecuta directo.** Entrevista primero, muestra el borrador, y recién crea el issue cuando
la persona lo aprueba.

---

## Regla número uno

> **El issue describe el PROBLEMA, no la solución.**

Quien reporta cuenta qué pasa, a quién le pasa y por qué importa. **Cómo** se arregla lo decide
quien lo implementa, mirando el código. Un issue que llega con la solución adentro suele estar
resolviendo el problema equivocado.

Si el reportante propone una solución, va a **Notas técnicas** con la aclaración de que es una
sugerencia, no una orden.

---

## Paso 1 — Entrevistar hasta tener lo mínimo

**No inventes nada. Lo que no te dijeron, se pregunta.** Un issue con huecos rellenados a ojo
hace perder más tiempo que uno que nunca se escribió.

Lo mínimo, según el tipo:

| Tipo | Sin esto no se crea |
| --- | --- |
| **Bug** | Qué esperaba que pasara · qué pasó en realidad · los pasos para verlo de nuevo · **si lo está viendo un cliente en producción** |
| **Feature / Mejora** | Para qué sirve (el motivo, no la pantalla) · quién lo usa · cómo sabemos que quedó bien |
| **Research** | Qué pregunta hay que responder · qué decisión está bloqueando · cuántas horas máximo |

Preguntas que casi siempre hay que hacer y casi nadie contesta sola:

- **¿Lo está sufriendo un cliente ahora mismo?** Cambia la prioridad entera.
- **¿Dónde lo viste?** Pantalla, URL, o "me lo contó el cliente por WhatsApp".
- **¿Pasa siempre o una sola vez?**
- **¿Tenés captura, el número que salió mal, o el mensaje de error?** La evidencia cruda vale más
  que la descripción.
- **¿Hay algún número de plata involucrado?** Si el sistema calculó mal un costo, eso no es un
  bug común — es lo más grave que puede pasar en este producto.

Si la respuesta a algo es "no sé", se escribe **"no sé"** en el issue. Es información honesta y
le dice al dev por dónde empezar a mirar.

---

## Paso 2 — Elegir el repo

Los issues van al repo donde vive el código que hay que tocar. Traducción para quien no programa:

| Lo que se ve | Repo | Cómo darse cuenta |
| --- | --- | --- |
| Un número mal calculado, algo que no se guardó, un error al importar, el mail que no llega, la API | `Coste-AR/CosteAR-backend` | El problema es con **los datos o las cuentas** |
| Un botón que no anda, algo que se ve mal, una pantalla del producto, un flujo confuso | `Coste-AR/CosteAR-frontend` | El problema es con **lo que se ve y se toca** en la app del cliente |
| El panel interno del equipo, la bitácora | `Coste-AR/CosteAR-admin` | Es una herramienta **nuestra**, no del cliente |

**Si no está claro, preguntá.** Y si de verdad es ambiguo (por ejemplo: "el total del dashboard
está mal" — puede ser el cálculo o cómo se muestra), **va al backend** y se aclara en el issue
que puede terminar siendo del frontend. Es más barato mover un issue que abrir dos.

Nunca crees el mismo issue en dos repos. Si el trabajo cruza los dos, se crea uno solo en el
repo del grueso del trabajo y se menciona el otro adentro.

---

## Paso 3 — Buscar duplicados (obligatorio)

Antes de crear nada:

```bash
gh issue list --repo Coste-AR/<repo> --state all --search "<2 o 3 palabras clave>" --limit 10
```

- Si ya existe y está **abierto**: no crear otro. Agregar la info nueva como comentario:
  ```bash
  gh issue comment <N> --repo Coste-AR/<repo> --body "<lo nuevo que se supo>"
  ```
- Si existe y está **cerrado** pero el problema volvió: crear uno nuevo que lo referencie
  (`Vuelve a pasar lo de #N`). No se reabre a ciegas — puede ser otra causa.

---

## Paso 4 — Redactar

Usar la plantilla que corresponde, que ya está en el repo:

- `.github/ISSUE_TEMPLATE/bug.md`
- `.github/ISSUE_TEMPLATE/feature.md`
- `.github/ISSUE_TEMPLATE/research.md`

**Títulos.** Se leen en una lista de cincuenta: tienen que distinguirse solos.

| ✅ | ❌ |
| --- | --- |
| `Bug: el costo unitario del período abierto se muestra sin actualizar tras cargar una factura` | `Bug: anda mal el costeo` |
| `Costeo — permitir cerrar un período desde el listado, sin entrar al detalle` | `Mejora en la pantalla` |
| `Research: cómo notificamos al costista cuando llega un dato de un período ya cerrado` | `Ver tema notificaciones` |

**Criterios de aceptación.** La parte que más se saltea y la que decide si el issue sirve.
Tienen que ser verificables por alguien que no lo implementó:

| ✅ Verificable | ❌ Opinión |
| --- | --- |
| "Al cargar una factura con fecha del período abierto, el costo unitario de la pantalla cambia sin recargar" | "Que el costeo ande bien" |
| "Un usuario de la empresa A no ve ningún dato de la empresa B" | "Que sea seguro" |

**Escribí en castellano llano.** Si hace falta un término técnico, aclaralo entre paréntesis la
primera vez. Es la misma regla de la bitácora: lo tiene que entender todo el equipo.

**Nunca pegues credenciales, tokens ni datos personales del cliente.** Los repos de backend y
frontend son **públicos**. Si hace falta mostrar un dato real, cambiá los nombres y los números
identificatorios.

---

## Paso 5 — Etiquetar

Toda issue lleva **un `type:`, un `priority:` y un `area:`**.

| `type:` | Cuándo |
| --- | --- |
| `type:bug` | Algo que funcionaba mal o dejó de funcionar |
| `type:feature` | Algo que no existe todavía, o una mejora |
| `type:research` | Hay que averiguar algo antes de poder decidir |

| `priority:` | Criterio |
| --- | --- |
| `priority:alta` | Un cliente está bloqueado, o hay un número de plata mal calculado |
| `priority:media` | Molesta pero se puede trabajar igual; hay una vuelta |
| `priority:baja` | Mejora, deuda, prolijidad. Nadie está esperando |

> **La prioridad es del negocio, no técnica** — Alan y Lauti la ponen. Si un dev cree que está
> mal calibrada, se discute en el issue; no se cambia en silencio.

`area:` depende del repo:

| Repo | Áreas |
| --- | --- |
| backend | `area:costeo` · `area:trazabilidad` · `area:auth` · `area:infra` |
| frontend | `area:costeo` · `area:onboarding` · `area:ui` · `area:auth` |
| admin | `area:admin` · `area:bitacora` |

Si ninguna encaja, dejá el issue con `type:` y `priority:` solos y decilo — un área nueva la
crea un dev.

---

## Paso 6 — Crear el issue

**Mostrá el borrador completo y esperá el OK antes de correr esto.**

```bash
gh issue create --repo Coste-AR/<repo> \
  --title "<título>" \
  --label "type:bug,priority:alta,area:costeo" \
  --body "$(cat <<'BODY'
<el cuerpo completo, siguiendo la plantilla>
BODY
)"
```

**El issue se crea SIN asignar, a propósito.** Los devs lo toman según su carga; quien reporta
no reparte trabajo. Si algo es urgente de verdad, va con `priority:alta` **y** se le avisa a
Santi o a Giuli por fuera — una etiqueta no despierta a nadie.

Al terminar, devolvé el link del issue creado y pegalo donde se venía hablando del tema.

---

## Reglas de tamaño

| Regla | Por qué |
| --- | --- |
| **Un issue = una cosa entregable** | "Rehacer el módulo de costeo" no es un issue, es un proyecto. Si al describirlo aparecen tres "y además", son tres issues |
| **Si no lo podés contar en tres oraciones, es más de un issue** | Igual que con los PRs |
| **Un issue que nadie va a leer en seis meses no se escribe** | Una lista llena de ruido hace que se ignore la lista entera |
| **Las auditorías se cargan de a una** | Si de una revisión salen ocho hallazgos, son ocho issues chicos, no uno con ocho bullets. Uno con ocho bullets nunca se cierra |

---

## Gotchas conocidos

- **`gh` tiene que estar autenticado con la cuenta de quien reporta** (`gh auth status`). Si no lo
  está: `gh auth login`. El issue queda a nombre de esa cuenta, y eso importa — así el dev sabe a
  quién volver a preguntarle.
- **Los repos de backend y frontend son públicos.** Cualquiera en internet lee lo que escribas ahí.
  `CosteAR-admin` es privado, pero la regla de no pegar datos del cliente vale igual.
- **No inventes números de issue ni de PR.** Si `gh` no te los devuelve, poné `—` y decilo.
- **Si el issue nace de una reunión con el cliente, escribilo en el issue** ("sale de la reunión
  del 12/08 con Augusto"). Dentro de tres meses nadie se acuerda de dónde salió el pedido.
- **Esta skill no cierra issues.** Los cierra el PR que los resuelve, con `Closes #N`
  (ver `/costear-pr`).
- Los issues son **referencia, no especificación**: el dev que implementa valida contra el repo
  real y avisa si el issue está pidiendo algo que no se puede o que ya existe.
