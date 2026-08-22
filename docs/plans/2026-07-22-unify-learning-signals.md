# Unificar las señales de aprendizaje de todo CosteAR en un solo pipeline

> Documento de handoff para implementación. Escrito por Claude (Anthropic) tras
> una sesión de auditoría y arreglo del sistema RAG/bóveda de conocimiento.
> Este plan lo va a ejecutar otro agente (Antigravity) — está escrito asumiendo
> cero contexto previo de la conversación en la que se originó.

## Tarea 0 (hacer PRIMERO, antes que todo lo demás): resolver el push pendiente de CosteAR-frontend

`CosteAR-backend` ya está pusheado a `origin/dev` sin problemas — no requiere
ninguna acción.

`CosteAR-frontend` **no está pusheado**. Estado exacto al momento de escribir
esto:

- Rama local `dev`, tip en `d1001a5` (2 commits arriba de `c95a503`, que sí
  está en `origin/dev`):
  - `6e953e6` — "fix: arregla el chat de la bóveda de conocimiento (RAG) en admin"
  - `d1001a5` — "feat: permite editar propuestas del pipeline nocturno antes de aprobar/rechazar"
- `origin/dev` está en `8ef4fc8`, con **11 commits que la rama local no
  tiene** — trabajo real de otros compañeros (Alan, Santiago, Lautaro) que se
  mergeó directo a `dev` sin pasar por `staging`. Corré `git log
  d1001a5..origin/dev --oneline` en `CosteAR-frontend` para verlos.
- Al intentar `git merge origin/dev` (ya lo probé, después lo aborté con
  `git merge --abort` para no dejar nada roto a medio resolver) salen
  **conflictos de contenido en 5 archivos**, porque tanto el refactor grande
  de Antigravity (ya incluido en los commits de `dev`) como el trabajo de
  los compañeros tocaron las mismas zonas:
  - `src/features/companies/CompanyDetailPage.tsx`
  - `src/features/cost-structures/CostStructurePage.tsx`
  - `src/features/cost-structures/IndirectCostsForm.tsx`
  - `src/features/dashboard/CostitaChat.tsx`
  - `src/features/validaciones/ValidacionesPage.tsx`

**Los 2 commits propios (`6e953e6`, `d1001a5`) NO tocan ninguno de esos 5
archivos** — el conflicto es enteramente entre el refactor de Antigravity y
el trabajo de los compañeros, algo previo y ajeno a este plan.

Qué hacer:
1. `git checkout dev && git merge origin/dev` en `CosteAR-frontend`.
2. Resolver los 5 conflictos leyendo ambos lados con cuidado — no es
   mecánico, hay que entender qué hace cada versión en cada sección del
   archivo y combinar sin perder funcionalidad de ninguno de los dos lados
   (ni el refactor de componentes de Antigravity, ni las correcciones de los
   compañeros como F01-B, F05, el fix de "GASTO" como grupo no-costo, etc.).
3. Después de resolver: `npx tsc --noEmit` limpio, `npm test` sin
   regresiones (antes del merge: 5/5 tests pasando), y una pasada rápida en
   el navegador de las pantallas que tocan esos 5 archivos (empresa,
   estructura de costos, chat del costista, validaciones) para confirmar que
   no quedó nada roto visualmente.
4. `git push origin dev`.

No forzar el push (`--force`) bajo ningún concepto — origin/dev tiene
trabajo real de otras personas que no se puede perder.

## Contexto: qué es CosteAR y por qué existe este pipeline

CosteAR es un SaaS para costistas argentinos (profesionales que llevan la
contabilidad de costos de PyMEs). Tiene, entre otras cosas:

1. Una **Bóveda de Conocimiento** (`CosteAR-vault`, un repo Git separado con
   archivos Markdown estilo Obsidian) con la metodología de costeo de la
   cátedra de la UNT. Un sistema RAG (pgvector + Voyage embeddings + Groq)
   permite consultarla con garantía de cero alucinaciones: el LLM solo puede
   responder con lo que está literalmente en los chunks recuperados, o
   negarse.
2. Un **pipeline de aprendizaje nocturno** (`nightly-learning`) que junta
   señales del día (`DailySignal`), le pide a un LLM que redacte propuestas
   concretas de edición a la bóveda (`VaultEditProposal`), y esas propuestas
   quedan pendientes hasta que un ADMIN humano las apruebe (y recién ahí se
   comitean al repo de la bóveda) o las rechace. Nunca se escribe nada en la
   bóveda sin revisión humana.
3. Un clasificador de documentos (facturas, remitos) que corre en capas
   (`src/infrastructure/classifier/layers/layer4-*.ts`) y que los costistas
   usan a diario para auditar comprobantes de sus clientes (pantalla
   "Validación de Insumos").
4. Un chat conversacional para el costista en su dashboard
   (`CostitaChat.tsx` → `/costista-chat/interpret`) que lo ayuda a cargar
   datos y crear alertas por lenguaje natural.

**El problema que este plan resuelve:** hoy existen tres sistemas de
"aprendizaje" completamente aislados entre sí. El pipeline nocturno (punto 2)
solo se entera de lo que pasa en el chat de bóveda del ADMIN. Todo lo que
hacen los costistas/operarios en su trabajo diario — corregir clasificaciones,
usar el chat del dashboard — se pierde o queda enterrado en tablas que el
admin nunca ve. La visión del producto es que **toda la actividad real de
costistas/operarios alimente el mismo pipeline de aprendizaje**, y que el
admin tenga un solo lugar (`/admin/vault` y `/admin/stats`) donde ver todo lo
que el sistema está aprendiendo, de dónde viene, y aprobar o rechazar mejoras
a la bóveda en consecuencia.

## Estado actual (verificado en el código, no es una suposición)

### Sistema A — Chat de bóveda del ADMIN (ya conectado, ya funciona)

Archivo: `src/application/vault-query/vault-query-service.ts`

Crea `DailySignal` en dos casos:
- No se encontraron chunks relevantes en la búsqueda vectorial (`type:
  'RAG_MISS'`, línea ~71).
- El LLM se negó a responder porque el contexto no alcanzaba (`type:
  'RAG_MISS'`, línea ~111).

También `src/infrastructure/http/routes/vault.routes.ts` línea ~126: el
endpoint `POST /vault/feedback` (autenticado, cualquier rol) crea `type:
'USER_CORRECTION'` cuando alguien reporta que una respuesta estaba mal.

Estas señales las procesa `nightly-learning-service.ts` cada noche (o manual
vía `POST /admin/nightly/run`), genera `VaultEditProposal`s, y aparecen en
`/admin/vault` para aprobar/editar/rechazar. **Todo este circuito ya está
arreglado y probado end-to-end** (sesión previa). No tocar la lógica interna
de `vault-query-service.ts` ni de `nightly-learning-service.ts` salvo donde
este plan lo indica explícitamente.

### Sistema B — Corrección de clasificación de documentos (NO conectado)

Archivo: `src/application/validaciones/validaciones-service.ts`, método
`review()` (empieza en línea 91).

Cuando un costista revisa un documento clasificado por IA y lo marca como
`CORRECTED` (línea ~154, variable `overrode`), el código:
1. Actualiza `ClassificationAudit` con la corrección real (línea ~165).
2. Actualiza/crea `SupplierFingerprint` (línea ~209 en adelante): un sistema
   de "huella por proveedor" que ajusta la confianza futura del clasificador
   para ese CUIT según cuántas veces acertó vs. cuántas veces lo corrigieron.

Esto **funciona bien y hay que dejarlo tal cual está** — es un mecanismo de
aprendizaje estadístico rápido, en tiempo real, específico por proveedor.
El problema es que es **invisible**: no crea ningún `DailySignal`, no aparece
en `/admin/stats`, no puede generar una propuesta de mejora a la bóveda. Si
distintos costistas corrigen el mismo tipo de error una y otra vez (ej.
"el sistema clasifica mal las notas de crédito de flete como Materia Prima"),
hoy esa señal no llega a ningún lado donde alguien pueda decidir mejorar la
documentación de la bóveda sobre cómo distinguir esos casos.

### Sistema C — Chat del costista en el dashboard (NO conectado)

Archivos: `src/application/costista-chat/costista-chat-service.ts` (método
`interpret()`, línea ~90) y `src/infrastructure/ai/groq-costista-chat.ts`.

Es un asistente conversacional completamente separado del RAG de la bóveda:
no busca en `vault_chunks`, solo arma contexto de la cartera del costista
(empresas, alertas, macro) y le pide a Groq que interprete el mensaje. La
respuesta trae `confidence: number` (0-100) y `actionType`. Cuando no está
configurado o no puede interpretar nada útil, devuelve el fallback
`{ reply: 'Por el momento no puedo interpretar eso...', actionType:
'INFO_ONLY', confidence: 0 }` (línea ~96-100). **Esto nunca se registra en
ningún lado.** Si un costista le pregunta algo al asistente y el asistente no
sabe responder, esa falla se pierde — es exactamente el mismo tipo de señal
que un `RAG_MISS` del chat del admin, pero de un sistema distinto.

## Resultado que queremos

1. Cuando un costista corrige una clasificación de documento, o el chat del
   dashboard no puede ayudarlo, **se genera una `DailySignal`** igual que
   pasa hoy con el chat de bóveda del admin.
2. El pipeline nocturno **procesa las tres fuentes juntas** cada noche y
   decide, señal por señal, si amerita una propuesta de edición a la bóveda
   (puede decidir que no — por ejemplo, una pregunta de "¿cómo cargo una
   empresa?" no es material de bóveda de costeo, y el prompt ya soporta
   devolver `[]` cuando algo es irrelevante).
3. En `/admin/stats` y `/admin/vault` el admin puede ver **de dónde viene
   cada señal** (chat de bóveda / clasificación / chat de costista), no solo
   un número total pelado como ahora.
4. Nada de esto se aplica solo: sigue habiendo revisión humana obligatoria
   antes de que cualquier cosa se comitee a la bóveda — este plan NO cambia
   esa garantía, solo amplía qué actividad alimenta las propuestas que un
   humano después aprueba o rechaza.

## Diseño

### 1. Schema: agregar procedencia (`source`) a `DailySignal`

Archivo: `prisma/schema.prisma`. Buscar `enum DailySignalType` y `model
DailySignal` (aprox. línea 984-1009 al momento de escribir esto, puede haber
corrido).

```prisma
enum DailySignalSource {
  ADMIN_VAULT_CHAT      // chat de bóveda del admin (vault-query-service, /vault/feedback)
  COSTISTA_CHAT         // asistente conversacional del dashboard del costista
  CLASSIFICATION_REVIEW // corrección de clasificación de documentos en Validaciones
}

enum DailySignalType {
  RAG_MISS
  USER_CORRECTION
  IMPROVEMENT_REPORT
  ASSISTANT_MISS // NUEVO: un asistente conversacional (no RAG) no supo ayudar — hoy solo lo usa el chat del costista
}

model DailySignal {
  id        String            @id @default(uuid()) @db.Uuid
  type      DailySignalType
  source    DailySignalSource @default(ADMIN_VAULT_CHAT) // NUEVO
  status    DailySignalStatus @default(PENDING)
  content   String
  context   Json?
  userId    String?           @db.Uuid
  user      User?             @relation(fields: [userId], references: [id], onDelete: SetNull)
  createdAt DateTime          @default(now())
  updatedAt DateTime          @updatedAt

  @@index([status])
  @@index([source]) // NUEVO — para poder agrupar por fuente en /admin/stats sin table scan
  @@map("daily_signals")
}
```

**Por qué un enum nuevo y no reusar `context: Json`:** `/admin/stats` va a
necesitar agrupar y contar por fuente (`GROUP BY source`). Con un campo en
`context` (JSON) eso requiere raw SQL o filtros JSON incómodos; con un enum
normal es un `groupBy` de Prisma estándar, igual al patrón que ya usa el
código para `type` (ver `admin.routes.ts`, línea ~38-39: `prisma.dailySignal.
count({ where: { type: 'RAG_MISS' } })`).

**Sobre la migración — leé esto antes de correr `prisma migrate dev`:**
Este proyecto tiene una molestia conocida: como el schema usa varios campos
`Unsupported()` (vector, tsvector) que Prisma no puede introspeccionar del
todo, cada `prisma migrate dev` tiende a generar automáticamente sentencias
de "drift" que NO tienen que ver con tu cambio — típicamente `DROP INDEX` en
índices de `vault_chunks` (HNSW/GIN, hechos a mano) y `ALTER COLUMN ... DROP
DEFAULT` en columnas `id` de tablas sin relación (`allocation_bases`,
`cost_periods`, etc.). **Esas sentencias hay que borrarlas a mano del
`migration.sql` generado antes de aplicarlo** — si las dejás, vas a romper los
índices de la bóveda o vas a chocar con un error de Postgres tipo "column is a
generated column" en `contentTsv`. El único contenido legítimo de esta
migración debería ser el `CREATE TYPE "DailySignalSource"` y el `ALTER TABLE
"daily_signals" ADD COLUMN "source" ...` (+ el índice). Si `migrate dev` te
tira más que eso, achicá el archivo a mano, y si ya se marcó como fallida,
`npx prisma migrate resolve --rolled-back <nombre>` antes de reintentar.

Correr `npx prisma generate` después. Si da `EPERM`/archivo bloqueado en
Windows, es porque el servidor (`npm run dev`, proceso `tsx watch`) tiene el
motor de Prisma abierto — pará ese proceso, regenerá, volvé a levantarlo.

### 2. Emitir señales desde clasificación (`validaciones-service.ts`)

En el método `review()`, donde ya existe el bloque que actualiza
`SupplierFingerprint` (línea ~209 en adelante, dentro del `if (input.status
=== 'APPROVED' || input.status === 'CORRECTED')`), agregar: cuando `overrode
=== true` (el costista corrigió), crear una `DailySignal`:

```ts
if (overrode) {
  await tx.dailySignal.create({
    data: {
      type: 'USER_CORRECTION',
      source: 'CLASSIFICATION_REVIEW',
      content: `Documento clasificado como "${audit.documentType}"/"${audit.costSection}" fue corregido por el costista a "${truthDocumentType}"/"${truthCostSection}".`,
      context: {
        entryId,
        supplierCuit: supplierCuit ?? null,
        originalDocumentType: audit.documentType,
        originalCostSection: audit.costSection,
        correctedDocumentType: truthDocumentType,
        correctedCostSection: truthCostSection,
      },
      userId: costistId,
    },
  });
}
```

Usar `tx` (el cliente de transacción ya disponible en ese scope), no
`prisma` directo, para que quede atómico con el resto del `review()`.

**No** crear una señal cuando `input.status === 'APPROVED'` sin corrección —
eso es "el sistema acertó", no hay nada que aprender ahí (y generaría
muchísimo ruido: la mayoría de los documentos se aprueban sin cambios).

### 3. Emitir señales desde el chat del costista (`costista-chat-service.ts`)

En el método `interpret()` (línea ~90), después de obtener `result` del LLM
(o al usar el `fallback`), evaluar si conviene registrar señal. Criterio:
`actionType === 'INFO_ONLY'` (no propuso ninguna acción concreta) **y**
`confidence < 50`. Ejemplo:

```ts
async interpret(userId: string, input: InterpretInput): Promise<CostitaChatResponse> {
  const portfolio = await this.buildPortfolioContext(userId);

  const fallback: CostitaChatResponse = {
    reply: 'Por el momento no puedo interpretar eso. Probá con otra consulta.',
    actionType: 'INFO_ONLY',
    confidence: 0,
  };

  if (!groqChat.isConfigured) {
    await this.recordAssistantMiss(userId, input.message, fallback);
    return fallback;
  }

  const result = await groqChat.interpret(input.message, portfolio, input.conversationHistory ?? []);
  const finalResult = result ?? fallback;

  if (finalResult.actionType === 'INFO_ONLY' && finalResult.confidence < 50) {
    await this.recordAssistantMiss(userId, input.message, finalResult);
  }

  return finalResult;
}

private async recordAssistantMiss(userId: string, message: string, result: CostitaChatResponse): Promise<void> {
  await this.db.dailySignal.create({
    data: {
      type: 'ASSISTANT_MISS',
      source: 'COSTISTA_CHAT',
      content: message,
      context: { reply: result.reply, confidence: result.confidence },
      userId,
    },
  });
}
```

Ojo: no todo `INFO_ONLY` es una falla — un `INFO_ONLY` con `confidence: 100`
puede ser el asistente respondiendo bien una pregunta general ("¿cómo cargo
una empresa?"). El umbral de confianza es lo que separa "contestó bien, solo
que no hay acción que ejecutar" de "no entendió nada". Si en la práctica este
umbral genera demasiado ruido o muy poca señal, es un parámetro para ajustar,
no una regla rígida.

### 4. Actualizar el prompt del pipeline nocturno para las nuevas fuentes

Archivo: `src/application/nightly-learning/nightly-learning-service.ts`.

Hoy el prompt arma la lista de señales así (línea ~52-56):
```ts
for (const signal of pendingSignals) {
  signalsStr += `ID: ${signal.id} | Tipo: ${signal.type} | Contenido: ${signal.content}\n`;
}
```

Agregar la fuente, para que el LLM tenga contexto de qué tipo de actividad
generó cada señal:
```ts
for (const signal of pendingSignals) {
  signalsStr += `ID: ${signal.id} | Tipo: ${signal.type} | Fuente: ${signal.source} | Contenido: ${signal.content}\n`;
}
```

Y agregar una regla al `SYSTEM_PROMPT` (ya tiene reglas numeradas 1-5,
agregar una 6) explicando qué significa cada fuente, para que el LLM sepa
qué tipo de propuesta tiene sentido en cada caso:

```
6. Las señales tienen una "Fuente": ADMIN_VAULT_CHAT (preguntas al chat de
   la bóveda), COSTISTA_CHAT (el asistente del dashboard del costista no
   supo ayudar — normalmente NO es sobre metodología de costeo, sino sobre
   cómo usar el software; si es así, marcá esa señal como no accionable y
   no generes una propuesta de edición a la bóveda para ella) o
   CLASSIFICATION_REVIEW (un costista corrigió cómo el sistema clasificó un
   comprobante). Para señales de CLASSIFICATION_REVIEW, la propuesta ideal
   es agregar o aclarar contenido en la bóveda que ayude a distinguir el
   tipo de documento/sección de costeo correctos — NO propongas cambiar
   código ni reglas del clasificador, solo documentación.
```

**No hace falta tocar** la lógica de deduplicación (`existingPending`,
`action: 'merge'`) ni el guardado de propuestas (`requiresVerification`,
`groundedInSignals`) — eso ya funciona igual sin importar la fuente de la
señal, se sigue aplicando tal cual.

### 5. Mostrar el desglose por fuente en el admin

**Backend** — `src/infrastructure/http/routes/admin.routes.ts`, endpoint
`GET /admin/stats` (línea ~17 en adelante). Ya cuenta `totalSignals`,
`pendingSignals`, `ragMisses` (`type: 'RAG_MISS'`), `userCorrections` (`type:
'USER_CORRECTION'`). Agregar un desglose por fuente:

```ts
const signalsBySource = await prisma.dailySignal.groupBy({
  by: ['source'],
  _count: true,
});
```

Y devolverlo en la respuesta, dentro de `data.vault` (agregar
`signalsBySource: signalsBySource.map(s => ({ source: s.source, count:
s._count }))`).

**Frontend** — `src/features/admin/components/AdminOverview.tsx` (repo
`CosteAR-frontend`). Hoy muestra `stats?.vault.pendingSignals` como un
número pelado (línea ~132). Agregar debajo una lista chica con el desglose
por fuente (3 líneas: "Chat de bóveda: N · Clasificación: N · Chat costista:
N"), y actualizar la interfaz `VaultStats`/similar en `admin-hooks.ts` para
incluir `signalsBySource`.

## Alcance explícitamente afuera de este plan

- No tocar `SupplierFingerprint` — sigue funcionando exactamente igual,
  este plan solo agrega una emisión de `DailySignal` en paralelo, no
  reemplaza ese mecanismo.
- No hacer que el pipeline nocturno proponga cambios a
  `layer4-*.ts`/keywords del clasificador — el alcance de
  `VaultEditProposal` sigue siendo únicamente archivos Markdown de la
  bóveda.
- No cambiar el requisito de aprobación humana en ningún punto.

## Cómo verificar que quedó bien (sin escribir tests todavía)

Este código (`nightly-learning`, `validaciones-service`, `costista-chat-
service`) hoy **no tiene tests automatizados** — es deuda preexistente, no
introducida por este plan. Si hay tiempo, sería valioso agregar tests
unitarios para `recordAssistantMiss` y para el bloque nuevo en `review()`
siguiendo el patrón TDD ya establecido en el resto del repo (ver
`tests/application/*.test.ts` como referencia de estilo — mocks de Prisma a
mano, sin librería de mocking). Como mínimo, verificar a mano:

1. Corregir una clasificación en Validaciones → confirmar que aparece una
   fila nueva en `daily_signals` con `source = 'CLASSIFICATION_REVIEW'`.
2. Mandarle al chat del costista un mensaje que no pueda interpretar →
   confirmar que aparece una fila con `source = 'COSTISTA_CHAT'`.
3. Correr `POST /admin/nightly/run` → confirmar que las señales nuevas se
   procesan (pasan a `PROCESSED` o `REJECTED`) y que, si el LLM lo considera
   accionable, aparece una `VaultEditProposal` nueva en `/admin/vault`.
4. Abrir `/admin/stats` (o el nuevo desglose en `AdminOverview.tsx`) y
   confirmar que el conteo por fuente coincide con lo esperado.
5. Correr `npm test` en `CosteAR-backend` y confirmar que no se rompió nada
   existente (al momento de escribir este plan: 502/503 tests pasan, 1
   skip; el número de archivos de test puede haber cambiado).

## Archivos que este plan toca (resumen)

**CosteAR-backend:**
- `prisma/schema.prisma` (+ migración nueva)
- `src/application/validaciones/validaciones-service.ts`
- `src/application/costista-chat/costista-chat-service.ts`
- `src/application/nightly-learning/nightly-learning-service.ts`
- `src/infrastructure/http/routes/admin.routes.ts`

**CosteAR-frontend:**
- `src/features/admin/admin-hooks.ts`
- `src/features/admin/components/AdminOverview.tsx`

Ambos repos actualmente trabajan sobre la rama `dev`.
