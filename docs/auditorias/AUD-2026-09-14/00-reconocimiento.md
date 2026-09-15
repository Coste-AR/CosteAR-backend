# F0 — Reconocimiento — AUD-2026-09-14

Auditoría sobre `origin/staging`. Base de comparación (última auditoría): backend `07415de`, frontend `bf70d3d`.
Alcance adicional: regresión dirigida sobre 8 errores vivos y 5 reglas violadas (R6, R8, R10, R11, R13) — se verifican en F6, no en esta fase.

Corrido: 2026-09-14, sesión de terminal en `Costear.api` (working dir) + `Costear.web/CosteAR-frontend` (segundo repo).

---

## 1. Estado de ramas — backend (`Coste-AR/CosteAR-backend`)

```
$ git fetch origin --prune
 - [deleted]         varias ramas de feature ya mergeadas (17 borradas)
 * [new branch]      feat/g7-veredicto -> origin/feat/g7-veredicto
   33fcbbe..a0234dc  staging           -> origin/staging
   ad4afe0..836238c  dev               -> origin/dev
   97679e0..d1cb43c  metricas          -> origin/metricas

$ git log -1 --format='%h %ci %s' origin/staging
a0234dc 2026-09-14 01:00:20 -0300 Merge pull request #358 from Coste-AR/dev

$ git log -1 --format='%h %ci %s' origin/dev
836238c 2026-09-14 02:07:25 +0000 feat(operacion): marcar cargas fuera de rango (#357)

$ git log -1 --format='%h %ci %s' 07415de
07415de 2026-09-07 12:54:44 +0000 docs: registrar bloqueo de contrato de unidad (#273)
```

**⚠️ Working tree local desincronizado:** `git status --short --branch` da `## staging...origin/staging [behind 89]`.
La copia local de este repo (con la que corre esta sesión) tiene 89 commits menos que `origin/staging`. Cambios sin commitear en el working tree (preexistentes, no tocados en esta auditoría): `M .claude/skills/costear-pr/SKILL.md`, `M package-lock.json`, `?? .claude/skills/costear-auditoria/`.

### Diffstat del alcance (`07415de..origin/staging`)

190 archivos, +12796/−2149. Toca: `prisma/schema.prisma` (+101/−0, 7 migraciones nuevas), motor (`owner-dashboard-service.ts`, `period-comparison.ts`, `calculation-result-enrichment.ts`, `parametros-costeo-service.ts`), todo el subsistema RAG/vault (retriever, reranker, LLMService, contextual retrieval — feature nueva grande, F1-01 a F1-16), `capia.ts` (precios externos), `modulos-rubro-service.ts`, `unidad-gestion.ts`, `revision-carga-campo.ts`. 46 archivos de `docs/sesiones/` y 5 ADR nuevos (0012–0015).

### Commits en el alcance (33, sin merges)

```
836238c feat(operacion): marcar cargas fuera de rango (#357)
ad4afe0 feat: mostrar modo y mensajes en el briefing (#353)
73e7a1f feat: incorporar precios semanales de CAPIA (#352)
6d22767 chore(prisma): retirar guarda sin uso del vocabulario (#347)
0e9e0dd feat: exponer rubro en el tablero del dueño (#344)
274928e fix(ci): continuar la cola tras fallar el PAT (#343)
0ce9e5a feat(costeo): declarar unidad en resultados (#341)
d22a19b feat(ci): actualizar PR atrasados con CIRCUITO_PAT (#339)
58e9173 feat(rubros): configura módulos declarativos (#340)
59e3ae8 feat(workers): Sentry Cron Monitor para nightly-learning (#334)
107bb40 feat(metricas): informar balance verificable de la tanda (#338)
de64d8c fix(prisma): separar vocabulario de rubro y tenant (#330)
a3aac73 docs(adr): documenta 2 desvios retroactivos del spec del RAG (#333)
975ce67 feat(costeo): declarar la unidad de gestión en el tablero del dueño (#323)
90c3685 feat(vault): clasifica "001.1 - Teoría de Costos/" como CATEDRA (F1-02) (#331)
c2d6f78 feat(contrato-api): publicar contrato tipado de respuestas -- fase 1 (#325)
bfd918c ci(rag): workflow eval-rag como gate + README de tests/rag (#327)
8dff38b feat(rag): set dorado + npm run eval:rag (#327)
d91b9df fix(config): sacar defaults que fingen credenciales validas (#324)
d508ebd feat(vault): vault-query y advisor generan con Claude (#318)
4154271 feat(vault): re-ranking con Voyage rerank-2.5 (#316)
10c7b65 feat(vault): Contextual Retrieval — prefijo por chunk (#315)
722fd09 feat(admin): métricas reales del RAG desde vault_query_log (#314)
4761926 feat(vault): VaultRetriever híbrido vector + full-text con RRF (#313)
622bbb3 chore(deps): bump nodemailer from 9.0.1 to 9.1.1 (#312)
fb32f16 feat(vault): vault_query_log + feedback (#311)
831ca82 feat(ai): capa LLMService provider-agnóstica (#310)
d3ced22 feat(vault): sourceType + contextualPrefix en vault_chunks (#308)
2d58ca9 feat(vault): chunker recursivo con solape (#307)
f40ce74 feat(vault): el indexador respeta .vaultignore (#306)
90cdd08 docs(rag): plan de ejecución de Fase 1 (#305)
7f26737 docs(rag): rediseño del subsistema RAG (#305)
e0b96a7 feat(classifier): advertir escala fuera de calibración (#286)
8b40777 fix(legal): bloquear términos iniciales incompletos (#283)
8b22d0d test: actualizar Vitest a 5 y corregir mocks (#280)
e231f72 feat(operacion): declarar escala física por empresa (#279)
ea1dbd2 test(costeo): cubrir 4xx de configuración (#277)
e8819fc ci(auto-etiquetar): los bumps de Dependabot sin cambio de mayor entran solos (#276)
985c70c feat(costeo): declarar unidad de gestión por empresa (#275)
```

### PRs mergeados en el alcance (mergedAt > 2026-09-07T12:54:44Z)

| PR | Base | Fecha | Título |
|---|---|---|---|
| 358 | staging | 09-14 | Promoción dev → staging (13-09, noche) |
| 357 | dev | 09-14 | feat(operacion): marcar cargas fuera de rango |
| 353 | dev | 09-13 | feat: mostrar modo y mensajes en el briefing |
| 352 | dev | 09-13 | feat: incorporar precios semanales de CAPIA |
| 349 | staging | 09-13 | Promoción dev → staging (13-09) |
| 347 | dev | 09-13 | chore(prisma): retirar guarda sin uso del vocabulario |
| 344 | dev | 09-12 | feat: exponer rubro en el tablero del dueño |
| 343 | dev | 09-12 | fix(ci): continuar la cola tras fallar el PAT |
| 341 | dev | 09-12 | feat(costeo): declarar unidad en resultados |
| 340 | dev | 09-12 | feat: configura módulos de rubro por empresa |
| 339 | dev | 09-12 | feat(ci): actualizar PR atrasados con CIRCUITO_PAT |
| 338 | dev | 09-11 | feat(metricas): informar balance verificable de la tanda |
| 334 | dev | 09-11 | feat(workers): Sentry Cron Monitor para nightly-learning |
| 333 | dev | 09-11 | docs(adr): documenta 2 desvíos retroactivos del spec del RAG |
| 331 | dev | 09-11 | feat(vault): clasifica "001.1 - Teoría de Costos/" como CATEDRA |
| 330 | dev | 09-11 | fix(prisma): separar vocabulario de rubro y tenant |
| 327 | dev | 09-10 | feat(rag): set dorado + eval:rag + gate de CI |
| 325 | dev | 09-10 | feat(contrato-api): publicar contrato tipado — fase 1 (part of #282) |
| 324 | dev | 09-10 | fix(config): sacar defaults que fingen credenciales válidas (part of #255) |
| 323 | dev | 09-11 | feat(costeo): declarar unidad de gestión en el tablero del dueño (part of #252) |
| 320 | staging | 09-10 | promo(staging): Fase 1 del RAG (27 commits) |
| 318 | dev | 09-10 | feat(vault): vault-query y advisor → Claude |
| 316 | dev | 09-10 | feat(vault): re-ranking con Voyage rerank-2.5 |
| 315 | dev | 09-09 | feat(vault): Contextual Retrieval |
| 314 | dev | 09-09 | feat(admin): métricas reales del RAG |
| 313 | dev | 09-09 | feat(vault): VaultRetriever híbrido |
| 312 | dev | 09-09 | chore(deps): bump nodemailer |
| 311 | dev | 09-09 | feat(vault): vault_query_log + feedback |
| 310 | dev | 09-09 | feat(ai): capa LLMService provider-agnóstica |
| 308 | dev | 09-09 | feat(vault): sourceType + contextualPrefix |
| 307 | dev | 09-09 | feat(vault): chunker recursivo |
| 306 | dev | 09-09 | feat(vault): .vaultignore + frontmatter |
| 305 | dev | 09-09 | docs(rag): rediseño del subsistema RAG |
| 286 | dev | 09-09 | feat(classifier): advertir escala fuera de calibración |
| 285 | staging | 09-09 | promo(staging) |
| 283 | dev | 09-09 | fix(legal): bloquear términos iniciales incompletos |
| 280 | dev | 09-07 | test: actualizar Vitest a 5 y corregir mocks |
| 279 | dev | 09-07 | feat(operacion): declarar escala física por empresa |
| 277 | dev | 09-07 | test(costeo): cubrir 4xx de configuración |
| 276 | dev | 09-07 | ci(auto-etiquetar): bumps de Dependabot |
| 275 | dev | 09-07 | feat(costeo): declarar unidad de gestión por empresa |

**Nota de alcance:** son 39 PRs (26 `feat/fix/test/chore` + 4 promociones + resto `ci`/`docs`). La verificación del criterio de aceptación número-por-número de cada uno se declara **fuera de esta fase** (F0 es reconocimiento, no plan): se hace en F1 sobre los PRs que F1 priorice por riesgo, no sobre los 39. Los que tocan el motor o el dominio de costeo (275, 279, 286, 323, 324, 325, 338, 340, 341, 344, 347, 352, 357) son candidatos obligados para F2/F3.

---

## 2. Estado de ramas — frontend (`SantiagoBriz/CosteAR-frontend`, checkout en `Costear.web/CosteAR-frontend`)

```
$ git fetch origin --prune
 - [deleted]  40 ramas de feature ya mergeadas
   2f75e57..b0e7b5f  staging  -> origin/staging
   1b099d3..6152dda  dev      -> origin/dev

$ git log -1 --format='%h %ci %s' origin/staging
b0e7b5f 2026-09-14 13:31:18 -0300 Merge pull request #178 from Coste-AR/dev

$ git log -1 --format='%h %ci %s' bf70d3d
bf70d3d 2026-09-05 17:43:21 +0000 ci(auto-merge): etiquetar `necesita-mano` al PR que quedo atrasado (#122)
```

**⚠️ Working tree local desincronizado, peor que el backend:** `[behind 44]`. Cambios sin commitear preexistentes: `M .claude/skills/costear-pr/SKILL.md`, `M package-lock.json`, `?? .audit-scratch/`, `?? .claude/skills/costear-auditoria/`.

### Diffstat del alcance (`bf70d3d..origin/staging`)

129 archivos, +12202/−2022. Toca fuerte: `ScenarioSimulator.tsx` (+357), `ResultTab.tsx` (+305/−0, prácticamente reescrito), `WasteTab.tsx` (+388, nuevo), `ThirdPartyWorkTab.tsx` (+166, nuevo), `OwnerDashboardPage.tsx` (+220), `CompanyRubroConfiguration.tsx` (+600, nuevo), `FieldPanelPage.tsx` (+285, nuevo — el "panel de campo" del sidebar). 7 specs E2E nuevos: `configuracion-rubro`, `desperdicios-periodo`, `panel-campo`, `parametros-negocio`, `simulador-clasificacion`, `trabajos-terceros-periodo`, y `auth.spec.ts`.

### Commits en el alcance (32, sin merges)

```
6152dda feat(dashboard): mostrar referencias semanales de CAPIA (#177)
2316a16 feat: completar configuración obligatoria en onboarding (#171)
447a16c feat: mostrar modo y mensajes en el briefing (#175)
1b099d3 feat(operacion): agregar panel de campo (#165)
9bc75ae feat(costeo): mostrar la unidad del negocio (#164)
786f16a feat: configurar módulos del rubro desde el perfil (#162)
a4bc612 fix(ci): continuar la cola tras fallar el PAT (#161)
e717f33 feat(costeo): mostrar los dos costos unitarios (#160)
573293e feat(ci): actualizar PR atrasados con CIRCUITO_PAT (#159)
3a50ab9 test(e2e): adjuntar captura completa por caso (#158)
d33048a test(features): saldar cobertura inicial por feature (#155)
40ea530 feat(costeo): cargar trabajos de terceros (#154)
55a8f3c feat(costeo): cargar desperdicios del período (#153)
cdfe625 fix(costeo): usar la clasificación real en el simulador (#148)
e6f6193 ci(tests): exigir cobertura mínima por feature (#150)
578f7b5 chore(deps): bump esbuild, vite and vitest (#147)
f1a2da7 chore(deps-dev): bump vite from 6.4.3 to 7.3.5 (#145)
28304df ci(auto-etiquetar): los bumps de Dependabot sin cambio de mayor entran solos (#146)
0af4258 chore(deps): bump form-data from 4.0.5 to 4.0.6 (#142)
12c48ce chore(deps-dev): bump js-yaml from 4.3.0 to 4.3.2 (#141)
bdff9f1 chore(deps-dev): bump browserslist from 4.28.2 to 4.28.9 (#140)
78a5650 chore(deps): bump dompurify from 3.4.12 to 3.4.15 (#139)
d219173 chore(deps-dev): bump fast-uri from 3.1.5 to 3.1.7 (#138)
f1e23cb chore(deps): bump postcss from 8.5.15 to 8.5.28 (#137)
600e05d chore(deps): bump axios from 1.17.0 to 1.18.0 (#136)
5420914 feat: permite configurar parametros del negocio (#135)
703791e fix: bloquear regresiones basicas de accesibilidad (#134)
c3270d5 ci(desbloquear): correr el barrido cuando termina el auto-merge (#131)
370f558 feat(dashboard): mostrar pendientes de cierre (#130)
edd1c63 test(auth): cubrir los flujos críticos de autenticación (#129)
49da79a promo(dev→staging): componentes Tab/Textarea + convenciones (#65) [nota: título trae #65, PR real 152]
1af89fa feat(ui): agregar componentes Tab y Textarea accesibles (#55) [nota: título trae #55, PR real 152]
```

### PRs mergeados en el alcance (mergedAt > 2026-09-05T17:43:21Z)

178(promo), 177, 176(promo), 175, 171, 167(promo), 165, 164, 162, 161, 160, 159, 158, 155, 154, 153, 152(promo), 150, 148, 147, 146, 145, 142, 141, 140, 139, 138, 137, 136, 135, 134, 131, 130, 129 — 34 PRs (25 feat/fix/test/chore + 4 promociones + resto ci). Candidatos obligados para F4 (pantalla): 177 (CAPIA en tablero), 171 (onboarding), 165 (panel de campo), 164 (unidad del negocio), 162 (módulos de rubro), 160 (dos costos unitarios), 154 (trabajos de terceros), 153 (desperdicios), 148 (clasificación real en simulador), 135 (parámetros de negocio), 130 (pendientes de cierre).

---

## 3. Relevamiento de entorno

### a) ¿Hay base de datos local levantable? ¿Cómo?

Sí. `docker-compose.yml` en el backend define `postgres` (imagen **obligatoria** `pgvector/pgvector:pg16` — con `postgres:16` común falla la migración `add_vault_chunks`) y `redis`.

```
$ docker compose ps
NAME               IMAGE                    STATUS                  PORTS
costear-postgres   pgvector/pgvector:pg16   Up 24 hours (healthy)   0.0.0.0:5433->5432/tcp
costear-redis      redis:7-alpine           Up 24 hours (healthy)   0.0.0.0:6380->6379/tcp
```

Ya estaba levantado y healthy al arrancar esta sesión (24 h de uptime). Puertos no estándar a propósito (5433/6380) para no chocar con instalaciones locales.

**Pero el schema de esa base NO está al día con `origin/staging`:**

```
$ npx prisma migrate status
73 migrations found in prisma/migrations
Database schema is up to date!
```

Esto es "al día" contra las 74 migraciones que hay en el **working tree local** (que está 89 commits atrás). Comparado contra `origin/staging`:

```
$ diff <(ls prisma/migrations) <(git ls-tree --name-only origin/staging -- prisma/migrations | ... árbol recursivo)
83 migraciones en origin/staging vs 74 locales — faltan 9:
20260902170000_add_egresos_producto
20260903090000_add_ventas_producto
20260907144908_add_unidad_gestion
20260907204851_operation_scale_package
20260909190430_add_vault_chunk_sourcetype_context
20260909192054_add_vault_query_log
20260911215022_configuracion_modulos_rubro
20260913170000_add_capia_macro_source
20260914015000_add_revision_cargas_campo
```

**Hallazgo de entorno, no de producto:** para que F3 corra contra el código real de `origin/staging`, hace falta sincronizar el working tree local (`git checkout origin/staging` o equivalente) y correr `npm run db:setup` de nuevo — 9 migraciones están pendientes. No se hizo en esta fase porque F0 es reconocimiento, no ejecución, y el working tree tiene cambios sin commitear preexistentes (ajenos a esta auditoría) que hay que resguardar antes de mover la rama.

### b) ¿Hay seed para sembrar una empresa de prueba? ¿Comando?

Sí, varios, en `package.json`:

```
npm run seed:tenant-avicola   → tsx prisma/seed-tenant-avicola.ts   (empresa avícola completa)
npm run db:seed               → node prisma/seed.mjs                (seed genérico)
npm run admin:reset           → tsx scripts/seed-admin.ts           (usuario admin)
```

Archivos relacionados: `prisma/seed-paquete-avicola.ts`, `prisma/seed-vocabulario-avicola.ts`, `prisma/seed-industry-profiles.ts`, `scripts/create-operator.mjs`. El pack FX-AV de la skill (fixtures inventados) es independiente de esto — corre por Python contra `scripts/calc_fx_av.py`, no pega contra la base.

### c) ¿`npm run dev` levanta back y front? ¿Puertos?

Son procesos separados, uno por repo:

- Backend: `npm run dev` → `tsx watch --env-file=.env src/infrastructure/http/server.ts`. Puerto por `.env`: `PORT=3000`.
- Frontend: `npm run dev` → `vite`. Puerto por defecto de Vite: **5173**. `CORS_ORIGIN=http://localhost:5173` en el `.env.example` del backend confirma el maridaje. En dev, `VITE_API_URL` va vacío porque Vite proxea `/api` → `http://localhost:3000`.

No hay un solo comando que levante los dos: hacen falta dos terminales (una por repo).

### d) ¿Cuántos tests hay, cuántos corren, cuántos pasan, cuántos skippeados?

**Conteo estático sobre `origin/staging`** (vía `git ls-tree -r`, no el working tree):

| Repo | Suite | Archivos en `origin/staging` |
|---|---|---|
| Backend | `tests/**/*.test.ts` (todas) | 224 |
| Backend | `tests/integration/**` + resto con base | 21 + 4 sueltos |
| Frontend | `src/**/*.test.tsx?` (unitarios) | 52 |
| Frontend | `tests/e2e/**/*.spec.ts` (Playwright) | 11 |

**Corrida real**, pero **sobre el working tree local** (89/44 commits atrás de `origin/staging` — no representa el código auditado, solo sirve para confirmar que el entorno funciona):

Backend — primer intento falló por CMD-02 (faltaba `npx prisma generate` después de bajar cambios de schema):
```
Error: @prisma/client did not initialize yet. Please run "prisma generate"...
Test Files  37 failed | 131 passed (168)
```
Después de `npx prisma generate`:
```
$ npm test -- --reporter=dot
Test Files  167 passed | 1 skipped (168)
Tests       1531 passed | 4 skipped (1535)
Duration    34.07s
```
(168 archivos corridos localmente vs 224 en `origin/staging` — la diferencia son los tests que llegaron en los 89 commits que este working tree no tiene.)

Frontend:
```
$ npm test -- --reporter=dot
Test Files  20 passed (20)
Tests       149 passed (149)
Duration    41.68s
```
(20 archivos corridos localmente vs 52 en `origin/staging` — mismo motivo, 44 commits atrás.)

**Conclusión de (d):** el entorno funciona (`npm test` da 100% verde en lo que sí tiene), pero el número de "cuántos pasan" **no es válido como lectura de `origin/staging`** hasta sincronizar el working tree. Se repite en F2/F3 sobre la rama real.

Ningún test se marcó `.skip`/`.todo` a mano en lo corrido — los "skipped" que aparecen (1 archivo backend, ninguno frontend) son los que se auto-saltean por falta de `DATABASE_URL`/rol, según el mecanismo de `tests/db-dependent.mjs` (comportamiento esperado, no deuda).

### e) ¿Hay Playwright o algún runner de E2E de UI?

- **Backend:** no. Solo `test:http` (Supertest contra la app real, sin navegador — verifica contratos HTTP, no pantalla).
- **Frontend:** sí, Playwright 1.62.1 instalado (`npx playwright --version` responde). Config en `playwright.config.ts`:
  - 4 proyectos: `chromium`, `webkit`, `Mobile Chrome` (Pixel 5), `Mobile Safari` (iPhone 12).
  - `baseURL` configurable por `E2E_BASE_URL`, default `http://localhost:5173`.
  - Levanta su propio `webServer` (con `VITE_MIN_SPLASH_MS=0` para no pagar el splash de 5 s en cada navegación de la suite).
  - Captura screenshot **siempre** (no solo en fallo) + traza en el primer retry + video en fallo.
  - 11 specs en `origin/staging` (7 nuevos en este alcance: ver diffstat arriba). No se corrió la suite en esta fase — Playwright arranca su propio servidor Vite, así que correrla contra el working tree desincronizado tampoco daría una lectura válida del alcance; queda para F4 después de sincronizar.

---

## 4. Limitaciones declaradas de este parte

- No se relevó `CosteAR-admin` en este parte (la auditoría es sobre backend + frontend del producto). Se linkea si F6 necesita cruzar bitácora.
- El criterio de aceptación numérico de cada uno de los 39+34 PRs en alcance no se verificó individualmente acá — es trabajo de F1 (mapa de riesgo), no de F0.
- El estado de la deuda de tests conocida (ESTADO.md menciona flaky `indirect-costs-capacidad-normal`, fechado 25-08-2026) no se re-verificó en esta fase.
