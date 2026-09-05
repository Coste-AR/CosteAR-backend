# AGENTS.md — cómo se trabaja en este repo

Esto es `Coste-AR/CosteAR-backend`: la API, el motor de cálculo y los workers de CosteAR.

**Leelo entero antes de tocar nada.** Es el contrato de trabajo del repo, y está acá porque un
agente arranca frío: si no está escrito, lo inventa.

Las convenciones de fondo (dominio, estilo, decisiones históricas) están en
[`CLAUDE.md`](CLAUDE.md) y [`CONTRIBUTING.md`](CONTRIBUTING.md). Aplican igual. Este archivo es lo
mínimo que no podés no saber.

> Esto calcula costos reales de una empresa real. Un número mal no es un bug de display: es una
> decisión de negocio equivocada que toma el cliente con nuestros datos.

## Lo primero, antes de leer el issue

```bash
npm run briefing
```

Te imprime en qué estado está el proyecto **ahora**: en qué rama estás, si tu copia quedó atrás
de `origin/dev`, qué PRs tuyos hay abiertos, qué issues tenés asignados, y el `ESTADO.md` con lo
que está pasando esta semana — incluidos los tests flaky conocidos, para que no pierdas media hora
re-corriendo una suite que ya sabemos que falla 1 de cada 4 veces.

Existe porque la trazabilidad escrita en documentos depende de que alguien se acuerde de leerlos,
y además envejece: un documento dice qué pasaba el 22 de agosto, no qué pasa hoy. Esto sale de
git y de `gh` en el momento.

## El ciclo

1. **Ramificá desde `dev`.** Nunca desde `main`: es producción, con un cliente usándola. Nombre de
   rama: `feat/…`, `fix/…`, `test/…`, `chore/…`.
2. **Commits convencionales** (`feat:`, `fix:`, `test:`, `chore:`). Hay commitlint: un mensaje mal
   formado te rebota el commit. Escribí el **por qué** en el cuerpo — este repo tiene la costumbre
   de explicar el motivo, no sólo el qué. Seguila.
3. **Abrí PR contra `dev`.**
4. **Antes de marcar el PR listo, poné tu rama al día con `dev`:**

   ```bash
   gh pr update-branch <numero-de-tu-pr>
   ```

   No es un trámite. El verde que tenías se calculó contra la versión de `dev` de cuando abriste
   la rama; si `dev` avanzó, ese verde ya no dice nada sobre cómo queda tu cambio integrado con lo
   que hay ahora. Dos PR verdes contra el mismo `dev` viejo entran los dos, y el segundo puede
   romperlo.

   Si no lo hacés, el auto-merge te lo va a pedir por comentario y el PR se queda esperando.

5. **Cuando esté listo y en verde, marcá el PR como listo y avisá. Ahí termina tu parte:**

   ```bash
   gh pr ready <numero>
   ```

   **Vos no ponés la etiqueta `auto-merge` y no mergeás.** Ni tu propio PR. La etiqueta la pone
   Santiago, y es el punto donde entra el juicio humano: **reemplaza al review, no es un trámite.**
   No hay reviews requeridos en este repo, así que sin ese freno cualquier PR entraría a `dev` en
   cuanto el CI se pusiera verde.

   El merge lo hace `.github/workflows/auto-merge.yml`, y sólo si todos los checks están en verde,
   la rama al día y sin conflictos. La persona dice "esto está listo"; la máquina verifica que sea
   cierto.

   Antes de avisar, mirá tu propio PR una vez más contra el issue: ¿hace lo que pedía? ¿te fuiste
   de alcance? ¿declarás cobertura que no tenés? Decilo en el mensaje con el que entregás, junto
   con lo que el issue no definía y tuviste que decidir vos.

   **Esperar no ayuda a nadie.** Un PR que se queda abierto se desactualiza contra `dev` y empieza
   a generar conflictos con el trabajo de los demás. Si está listo, decilo.

   El reparto completo de quién hace qué está en `CosteAR-os/ORQUESTACION.md`. **Ante cualquier
   contradicción entre este archivo y ese, manda ese.**

## Con qué se verifica

**Antes de la primera corrida**, después de `npm ci`:

```bash
npm run prisma:generate
```

Sin eso, `test:http` falla antes de ejecutar tres archivos, con un error que no dice que falta el
cliente de Prisma. Se comió un intento entero de la sesión de B0-3.

```bash
npm run lint              # eslint src tests
npm run typecheck         # tsc --noEmit
npm run test              # vitest — unitarios, sin base
npm run test:http         # supertest contra la app real — 49 tests, ~4 s
npm run test:integration  # RLS real contra Postgres. Necesita Docker levantado
npm run test:db           # trazabilidad y seguridad con base
```

### Las suites con base: levantá Docker vos

`test:integration` y `test:db` necesitan Postgres. **No hace falta que te lo levante nadie**, es
un comando más de tu checklist:

```bash
docker compose up -d postgres redis   # arranca en segundo plano
docker compose ps                     # esperá a que digan "healthy", no solo "running"
npm run db:setup                      # migraciones + RLS, la primera vez o si cambiaron
```

El `docker-compose.yml` ya define los healthchecks y los puertos (Postgres en **5433**, no 5432,
para no chocar con uno que tengas instalado). `.env.example` trae la `DATABASE_URL` que apunta
ahí. Al terminar podés dejarlo corriendo; `docker compose down` sin `-v` conserva los datos.

**Si `docker compose up` falla**, no saltees la suite ni la marques como "no aplica": decilo en el
PR con el error. Una suite de RLS que no corrió es exactamente el agujero de los 34 tests de
aislamiento entre empresas que estuvieron sin correr hasta el 15-08-2026, con el CI en verde.

> ⚠️ La imagen de Postgres **tiene que ser `pgvector/pgvector:pg16`**, no `postgres:16`. Está fija
> en el compose; si tenés un contenedor viejo creado con otra imagen, recrealo con
> `docker compose up -d postgres` — mantiene el volumen. Con la imagen común, la migración
> `add_vault_chunks` falla y bloquea toda migración nueva.

**Cuál corrés depende de qué tocaste:**

- Siempre: `lint`, `typecheck`, `test`.
- Si tocaste un endpoint, un código de estado o un contrato HTTP: **`test:http`**. Es el bucle
  corto — verifica que el *endpoint* devuelva 422 y no 500, que es distinto de verificar que una
  función devuelva lo esperado.
- Si tocaste RLS, aislamiento entre empresas o queries: **`test:integration`**. Sin excepción.

## Lo que te va a morder si no lo sabés

- **`prisma/schema.prisma`: hay deriva conocida.** Si Prisma quiere borrar algo que vos no
  tocaste, **declaralo en el schema; no lo dejes pasar**. Y si tu tarea necesita un cambio de
  schema que el issue no pidió, **pará y decilo en el PR** en vez de meterlo.
- **Los tests unitarios no levantan Postgres a propósito**, porque el CI de unitarios no tiene
  base. Un test que necesita base va en `tests/integration/` con su config, y **tiene que estar
  declarado en `tests/db-dependent.mjs`** — si no, `npm run check:tests-base` te rebota el CI. Esa
  guarda existe porque hubo 61 tests que no corrían en ningún lado, con el CI en verde igual.
- **La suite de integración corre con un rol sin `BYPASSRLS`**, no con el superusuario. Postgres
  ignora RLS entero para un superusuario: corriendo con él, la suite daba verde probando sólo la
  mitad de la protección.
- **Si tocás el motor de cálculo**, los fixtures de "Piezas mecánicas de precisión" y los tres
  casos de ITCS de la cátedra tienen que dar **exactamente** lo mismo que antes.
- **Migraciones aditivas.** Nada de `DROP` sobre tablas con datos.
- **Las mutaciones nuevas escriben su bitácora en la misma transacción.**

## Tu bitácora de sesión — obligatoria, va en el mismo PR

Escribí `docs/sesiones/AAAA-MM-DD-<issue>-<slug>.md`. No lo escribe otro después: lo que se anota
a mano al final es una promesa que se incumple sola.

- **Recursos:** tiempo, tokens, intentos hasta el verde, comandos corridos. Si la herramienta no
  te informa los tokens, poné **"no informado"** — no estimes. Un número inventado es peor que un
  hueco, porque alguien lo va a sumar.
- **Decisiones que tomaste sobre la marcha:** qué decidiste, qué otra opción había, por qué esa.
- **Dónde el issue no alcanzaba:** lo que tuviste que suponer porque no estaba escrito, **aunque
  hayas acertado**. No es una queja: es con lo que mejoramos cómo pedimos el trabajo.
- **Qué quedó afuera.**

Formato completo: `CosteAR-os/plantillas/bitacora-sesion-agente.md`.

## Antes de decir que algo ya está resuelto

Vale para cualquier trabajo de investigación: un triage, cerrar un issue viejo, contestar "eso ya
está hecho". **Que el código exista no significa que esté en `dev`.**

```bash
git merge-base --is-ancestor <commit> origin/dev && echo "SI llegó" || echo "NO llegó"
git branch -r --contains <commit>          # ¿en qué ramas vive?
git grep -n "<el símbolo que agregó>" origin/dev
```

**Los tres, no uno.** Que el archivo exista en `dev` no alcanza: puede existir por otro trabajo
distinto y parecido.

> **Pasó el 04-09-2026.** Un triage recomendó cerrar el issue #98 del backend —el control de
> variaciones presupuesto/volumen— afirmando que el commit "ya está en `origin/dev`". Estaba
> únicamente en una rama del 20-08 **sin ningún PR, ni abierto ni cerrado**. Lo que confundió es
> que en `dev` sí hay trabajo sobre variaciones, y el archivo de test existe y menciona la misma
> tolerancia: 12 coincidencias en `dev` contra 36 en la rama. **Se parecía lo suficiente como para
> dar por cerrado algo que no estaba.** Si se cerraba, se perdían 125 líneas y un ADR.

Tirando de ese hilo aparecieron **seis ramas remotas con commits fuera de `dev` y sin ningún PR**,
tres de ellas la implementación de issues que siguen abiertos. `PR-06` cubre *"se mergeó pero no
llegó"*; esto es el hueco de al lado: **trabajo que nunca se propuso**, así que no hay merge que
verificar y ninguna alarma que suene.

**Si encontrás una rama así, no la mergees ni la des por perdida: decilo en el issue con el commit
y la rama.** Que exista trabajo escrito cambia la recomendación, no la ejecuta.

## Lo que no hacés nunca

- **No mergeás.**
- **No borrás ni saltás tests para poner el CI en verde.** Si un test falla por tu cambio, o el
  cambio está mal o el test estaba mal — averiguá cuál, y decilo.
- **No amplías el alcance del issue.** Lo de paso va a un issue nuevo, y lo decís en el PR.
- **No metés secretos** en el código, en los tests ni en el commit.

## Qué tiene que decir tu PR

Qué hiciste, por qué, cómo probarlo, y **qué quedó afuera**. Pegá la salida de las suites que
corriste. Si encontraste un bug que no era tuyo, decilo con el número del issue que abriste.

---

El protocolo completo del equipo está en [`Coste-AR/CosteAR-os`](https://github.com/Coste-AR/CosteAR-os).

---

## Registro de cambios de este archivo

Este archivo es **normativo**: cambia lo que hace todo el mundo después. Por eso cada cambio deja
su fila acá, y por eso el auto-etiquetado no lo deja entrar sin ella — un PR que toca este archivo
y no declara qué cambió queda esperando a una persona.

|Fecha|Qué cambió|Fuente|
|---|---|---|
|2026-09-04|**Se agrega "Antes de decir que algo ya está resuelto".** Un triage recomendó cerrar un issue afirmando que el commit ya estaba en `dev`; estaba sólo en una rama sin PR, y cerrarlo habría perdido 125 líneas y un ADR. Se agregan los tres comandos que lo comprueban y qué hacer al encontrar una rama huérfana. **Y se inaugura esta tabla**, que no existía: sin ella ningún cambio a este archivo se podía auto-etiquetar.|Santiago|
