# Herramientas y tecnologías nuevas a evaluar — CosteAR

- **Fecha:** 2026-09-09
- **Alcance:** todo el stack, no solo RAG. Cada ítem tiene un veredicto y está atado a un dolor
  real del proyecto o a una mejora concreta, no a "está de moda".
- **Stack actual:** Node 22 · TS strict · Fastify 5 · Prisma 6 + Postgres/pgvector · BullMQ+Redis ·
  Vitest · Playwright · React 19 · Vite 6/7 · TanStack Router+Query · Zustand · Tailwind v4 ·
  Railway · Sentry · Groq + Voyage.

**Leyenda de veredicto:**
🟢 Adoptar ahora · 🟡 Evaluar (spike/issue) · 🔵 Mirar (todavía no) · ⚪ Descartado (con motivo)

---

## 1. Base de datos y migraciones

### 🟢 Atlas (`ariga/atlas`) para el drift de schema

**Dolor:** el issue #72 y toda su saga (deriva de `vault_chunks`, DEFAULTs/índices/FKs que Prisma
no modela y reaparecen como `DROP` en cada migración, el script `filtrar-deriva.mjs`, el reset de
la base local de esta misma sesión por `_prisma_migrations` inconsistente).

**Qué aporta:** Atlas modela lo que Prisma no puede —vistas, funciones, triggers, **RLS**,
columnas generadas, índices HNSW/GIN sobre tipos `Unsupported`—. `atlas migrate lint` bloquea
cambios destructivos en el PR; `atlas schema diff` detecta drift real vs esperado y lo comenta en
el PR (`ariga/atlas-action`). Se puede usar **junto a** Prisma (Prisma sigue generando el client;
Atlas gestiona las migraciones y el drift) — hay guía oficial Prisma+Atlas.

**Cómo entra:** issue de spike — modelar `rls.sql` + los índices de `vault_chunks` en HDCL de
Atlas, correr `atlas migrate lint` sobre las migraciones actuales, ver si reemplaza a
`migrate-dev.mjs`/`migrate-deploy.mjs`. Riesgo: curva de aprendizaje + dos herramientas de
migración conviviendo un tiempo.

**Si no se hace:** cada migración nueva sigue siendo un campo minado y el `schema.prisma` sigue
sin poder representar la mitad del schema real.

### 🔵 `pgvectorscale` / `VectorChord`

Mejoran inserción y escala del vector search. **A la escala de la bóveda (cientos de chunks) no
cambian nada.** Anotado para cuando el corpus crezca 100× (decenas de millones de vectores es la
línea donde Postgres-resident deja de alcanzar).

### 🟡 Neon como Postgres (en vez de Railway Postgres)

**Dolor:** el disco efímero de Railway rompió el loop de la bóveda y obligó al reset de la base de
esta sesión. Prisma `migrate dev` necesita una shadow DB que Railway no da fácil.

**Qué aporta Neon:** branching de base instantáneo → shadow DB gratis para `migrate dev`, y **una
base por PR** para previews (encaja con el flujo de PRs que ya tienen). Separa cómputo de
almacenamiento, sin disco efímero.

**Costo:** migrar el Postgres de producción de un cliente real. No es gratis ni urgente; es un
spike para pricing + plan de migración. El backend ya está desacoplado (Prisma), la fricción es
operativa.

### 🔵 Prisma 7

Están en Prisma 6; la 7 ya salió (client sin Rust engine, más rápido, ESM-first). Migración
mecánica pero con changelog para leer. Agendar cuando Atlas esté decidido (para no hacer dos
cambios de tooling de DB a la vez).

---

## 2. Capa LLM / IA (además de lo del spec del RAG)

### 🟢 Vercel AI SDK (`ai` + `@ai-sdk/anthropic` + provider de Groq) para `LLMService`

**Dolor:** el spec del RAG pide construir una interfaz `LLMService` a mano (F1-09) sobre
`@anthropic-ai/sdk` y `groq-sdk`.

**Qué aporta:** el AI SDK **ya es** esa abstracción: un `generateObject({ schema: zod, ... })`
con el mismo código para Anthropic, Groq, OpenAI; streaming, tool calling, structured output con
Zod (que ya usan), reintentos, y `experimental_telemetry` que emite OpenTelemetry (→ Langfuse /
Sentry) sin código extra. Prompt caching de Anthropic se configura por `providerOptions`.

**Recomendación:** F1-09 del spec del RAG usa el AI SDK en vez de escribir el wrapper. Menos
código propio, y la telemetría de LLM sale casi gratis.

### 🟡 Langfuse self-hosted (LLM observability)

Ya está en la Fase 2 del spec del RAG (F2-05). MIT, Docker Compose, trazas + prompt management +
datasets + evals contra tráfico real. Adquirido por ClickHouse en enero 2026 (self-hosting mejor
soportado, no peor). **Decisión con volumen**: si `vault_query_log` muestra tráfico bajo, alcanza
con la tabla propia + Promptfoo; si crece, Langfuse.

### 🟡 Promptfoo para evals

Ya está en Fase 1 del spec del RAG (F1-12/F1-13). Runner declarativo + gate de release. Se
complementa con métricas estilo RAGAS calculadas por un juez Claude. Nada nuevo que decidir acá,
solo se referencia.

### 🔵 Cambio de modelo de embeddings

`voyage-4-large` (1024d) que usan hoy está bien. `voyage-3-large`, Cohere `embed-v4` ($0.01/M,
lo más barato del mercado) o Gemini `embedding-001` solo valen un re-embeddeo completo **si los
evals muestran techo del modelo**. Es F3-03 del spec del RAG.

---

## 3. Tooling de frontend / build

### 🟡 Oxlint como pre-check (junto a ESLint, no en lugar de)

**Dolor:** `npm run lint` en frontend arrastra 108 warnings preexistentes y ESLint con reglas
type-aware es lento.

**Qué aporta:** Oxlint (Rust, del equipo de Oxc/VoidZero, el mismo detrás de Rolldown) parsea
50–100× más rápido, 655+ reglas, type-aware vía `tsgolint`. Se corre como pre-check en
milisegundos y deja ESLint para las reglas de plugin que Oxlint no tiene todavía. **Vite 8 lo
trae como linter por defecto.**

**Cómo entra:** issue chico — agregar `oxlint` al `pre-commit` y al CI como primer paso rápido;
ESLint queda para el gate final. Bajo riesgo, reversible.

### 🔵 Biome (reemplazo total de ESLint + Prettier)

Más ambicioso que Oxlint: una sola herramienta para lint + format. Vale si quieren **eliminar**
ESLint y Prettier, no solo acelerarlos. Más migración (reglas, config, CI, editores). Mirar
después de probar Oxlint.

### 🟡 Vite 8 + Rolldown

Están en Vite 6 (admin) / 7 (frontend). Vite 8 con el bundler Rolldown da builds 1.6–7.7× más
rápidos y trae Oxlint integrado. **Esperar a que Vite 8 sea estable** y subir de 6→7→8 de forma
escalonada (frontend ya está en 7). Issue de "bump de Vite" por repo.

### 🟢 React Compiler

Están en React 19 → el React Compiler (auto-memoización) ya es estable. Activarlo elimina la
mayoría de los `useMemo`/`useCallback` manuales y previene una clase entera de bugs de
renders. Es un plugin de Babel/SWC + una regla de ESLint. Issue chico, alto valor, bajo riesgo.

### 🔵 `typescript-go` (`tsgo`)

El compilador nativo de TS (Go), ~10× más rápido en typecheck. En preview. `npm run typecheck` es
parte del gate en los 3 repos; cuando `tsgo` sea estable, es un cambio de una línea. Mirar.

---

## 4. CI/CD y flujo de PRs

### 🟡 Mergify (capa de *merge queue*, conservando la etiqueta como gate)

**Dolor:** la bitácora del 04-09 describe exactamente lo que un merge queue resuelve — "el 30-08
se acumularon diez PRs en una tarde: aparecieron dos conflictos y hubo que re-actualizar ramas
todo el tiempo". El `auto-merge.yml` propio decide *cuándo un PR está listo*, pero no coordina
*el orden y el CI compartido de varios PRs listos*.

**Qué aporta Mergify sobre el setup actual:**
- Colas **paralelas por scope**: un PR de frontend no espera detrás de una migración de backend.
- **Batch** de varios PRs en una sola corrida de CI, con bisección automática si falla.
- CI de dos pasos (checks livianos en el PR, suite completa en la cola).
- Mantiene la lógica de "requiere la etiqueta `auto-merge`" que ya usan (gating por label es una
  feature explícita de Mergify; el merge queue nativo de GitHub no la tiene).
- No reconstruye el merge commit server-side → el SHA testeado es el SHA mergeado (el queue nativo
  de GitHub sí lo reconstruye).

**Contra:** es un servicio de terceros con acceso al repo; hoy el `auto-merge.yml` propio es
autocontenido y funciona en el plan Free sin branch protection. Evaluar si el dolor de la cola
justifica la dependencia. Alternativa gratis: **GitHub Merge Queue nativo** (necesita branch
protection → no aplica a `CosteAR-admin` privado en Free).

**Cómo entra:** spike en `CosteAR-backend` (el de más tráfico de PRs) con `.mergify.yml`, una
semana, comparar contra el `auto-merge.yml` actual.

### 🟢 Sentry Cron Monitors

**Dolor:** el pipeline nocturno del RAG (cron `0 2 * * *`) — si el worker deja de correr, nadie se
entera (justo el tipo de falla que la bitácora del 04-09 describe: "los eventos nunca se
disparaban"). Ya usan Sentry.

**Qué aporta:** `Sentry.captureCheckIn` alrededor de cada job repetible (nightly-learning,
macro-sync, recalculate) → alerta si un cron no corre o tarda de más. Config mínima, ya tienen el
SDK. Issue chico.

### 🟡 `knip` (dead code / deps / exports sin usar) en CI

**Dolor:** la bitácora del 04-09 encontró 6 ramas huérfanas y archivos muertos
(`anomaly-detection.ts` "figuraba como huérfano y había una versión peor corriendo en su lugar").

**Qué aporta:** `knip` detecta exports, archivos, dependencias y `devDependencies` sin usar. En CI
como warning primero, después como gate. Complementa las guardas de tests que ya tienen.

### 🟢 `claude-code-action@v1` de review

Ver `2026-09-09-organizacion-claude-code.md` §2.4 — review que comenta (no bloquea) sobre el diff
y los ADR. Es la segunda mirada que REV-05/06 piden y hoy no existe.

---

## 5. Observabilidad transversal

### 🟡 OpenTelemetry unificado (backend + workers + LLM)

Hoy: Sentry para errores, `console.*` para el resto, métricas de negocio ad-hoc en `admin/stats`.

**Qué aporta:** `@fastify/otel` + instrumentación de Prisma + BullMQ + el AI SDK
(`experimental_telemetry`) → un solo stream de trazas que puede ir a Sentry (ya lo tienen),
Langfuse (para LLM) o un Grafana/Tempo self-hosted. Una request de costeo se ve punta a punta:
HTTP → Prisma → cálculo → alerta.

**Cómo entra:** issue mediano, incremental (empezar por `@fastify/otel` + Prisma, sumar workers
después). No urgente pero es la base para diagnosticar los "el flujo estaba roto en dos lugares"
sin agregar `console.log`.

### 🔵 Grafana Cloud free / Better Stack para uptime + logs

Si OTel avanza, un backend de trazas/logs gratis o barato. Mirar cuando OTel esté puesto.

---

## 6. Monorepo — considerado y (por ahora) ⚪ descartado

Juntar `CosteAR-backend` + `CosteAR-frontend` + `CosteAR-admin` en un monorepo (Turborepo / Nx /
pnpm workspaces) mataría `skills:sync`, compartiría config de TS/ESLint/Vitest, y daría un solo
CI.

**Por qué no ahora:** `backend` y `frontend` son **públicos**, `admin` es **privado** (regla
CLI-01, y ya pasó una fuga de datos de cliente). Un monorepo obliga a elegir una visibilidad para
todo, o a submódulos/scripts que reintroducen la complejidad que se quería sacar. El plugin
`costear-devkit` resuelve el 80 % del dolor de "config duplicada" sin tocar la estructura de
repos. Reevaluar solo si la relación público/privado cambia.

---

## 7. Resumen: qué haría primero

| Prioridad | Ítem | Esfuerzo | Por qué primero |
|---|---|---|---|
| 1 | **AI SDK para `LLMService`** (dentro del spec RAG F1-09) | bajo | Evita escribir un wrapper propio; telemetría de LLM gratis |
| 2 | **Sentry Cron Monitors** | muy bajo | El nightly del RAG no puede fallar en silencio |
| 3 | **React Compiler** | bajo | React 19 ya está; elimina memoización manual |
| 4 | **Oxlint pre-check** | bajo | `lint` más rápido, sin migración |
| 5 | **Atlas (spike)** | medio | El dolor de schema drift es crónico y documentado |
| 6 | **Mergify (spike)** | medio | La cola de PRs ya causó conflictos reales |
| 7 | **knip en CI** | bajo | Caza el código muerto que la auditoría encontró a mano |
| 8 | **OTel unificado** | medio | Base para no volver a diagnosticar a ciegas |
| — | Neon / Vite 8 / Prisma 7 / Biome / typescript-go | — | 🔵 mirar, no ahora |

## Referencias

- Atlas + Prisma (gestión avanzada de schema): https://www.prisma.io/blog/advanced-database-schema-management-with-atlas-and-prisma-orm
- Herramientas de migración 2026 (Flyway/Liquibase/Atlas/Bytebase): https://www.bytebase.com/blog/top-database-schema-change-tool-evolution/
- Oxlint vs Biome 2026: https://jsmanifest.com/biome-oxlint-comparison-2026
- Vite 8 + Rolldown + Oxlint por defecto: https://dev.to/erikch/i-tried-vite-and-replaced-my-entire-frontend-toolchain-4cgb
- Vercel AI SDK (provider-agnóstico, structured output, telemetría): https://sdk.vercel.ai/docs
- Mergify vs GitHub Merge Queue (label gating, colas paralelas, batch+bisección): https://mergify.com/compare/github-merge-queue
- GitHub auto-merge nativo — cuándo alcanza y cuándo se queda corto: https://mergify.com/blog/github-auto-merge-when-native-is-enough
- Langfuse self-hosted: https://langfuse.com/self-hosting
- Postgres vector 2026 (pgvector default hasta ~10^7): https://www.web3aiblog.com/blog/postgres-vector-search-compared-pgvector-pgvectorscale-paradedb-lantern-2026
- Embeddings 2026 por MTEB/costo: https://www.premai.io/blog/best-embedding-models-for-rag-2026-ranked-by-mteb-score-cost-and-self-hosting/
