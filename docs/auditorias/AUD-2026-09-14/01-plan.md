# F1 — Plan y mapa de riesgo — AUD-2026-09-14

Alcance heredado de F0: backend 39 PRs (`07415de..a0234dc`), frontend 34 PRs (`bf70d3d..b0e7b5f`).

---

## 1. Los tres focos obligatorios — verificados ahora

### Foco 1 — RAG/vault no toca el motor (regla dura: mejora lo que el asesor RESPONDE, nunca lo que el motor CALCULA)

```
$ git grep -l "vault\|Voyage\|Groq\|LLMService\|VaultRetriever" -- src/domain/calculations
(sin resultados)
$ git grep -l "vault\|Voyage\|Groq\|LLMService\|VaultRetriever" -- src/application/cost-structures
(sin resultados)
```

**Limpio.** El subsistema RAG completo (F1-01 a F1-16: chunker, contextual retrieval, VaultRetriever híbrido, reranker Voyage, LLMService, vault_query_log) no tiene ni un import cruzado hacia `src/domain/calculations/` ni hacia `src/application/cost-structures/`. Verificado por ausencia de coincidencias en ambas rutas — no es una inferencia, es una búsqueda directa sobre el árbol de `origin/staging`.

### Foco 2 — `unidadGestion`: ¿existe, es declarada o inferida, y #252 desbloqueado?

- **Existe.** `prisma/schema.prisma`, modelo `Company`: `unidadGestionId String? @db.Uuid` con relación explícita a `UnidadMedida`. El comentario en el propio schema dice: *"Es explícita: no se infiere del rubro ni de ningún perfil global."*
- **Es una declaración del tenant, no una derivación de `IndustryProfile.measurementUnit`.** `src/domain/units/unidad-gestion.ts` → `crearConversorUnidadGestion(unidadGestion)`: sin unidad declarada devuelve `unidadGestion: null` y los valores quedan en base — no adivina. Coincide con lo que la auditoría anterior pedía descartar.
- **Issue #252 está CERRADO** (`2026-09-12T01:47:32Z`) — "la API no dice en qué unidad está cada número que devuelve". Hay **ADR 0015** (`docs/adr/0015-proyectar-resultados-en-unidad-de-gestion.md`) documentando la decisión.

**Limpio.** Contrato resuelto tal como la auditoría anterior lo exigía. Se re-verifica el contenido del ADR y el uso real del conversor en F3 (con datos reales, no solo lectura de código).

### Foco 3 — CAPIA: ¿la fuente y fecha viajan con el dato? ¿puede entrar al motor como costo declarado?

- **Modelo `MacroSnapshot`** (`prisma/schema.prisma:744`): `source` (enum, incluye `CAPIA`), `indicatorCode`, `value`, `effectiveDate`, `fetchedAt`, `metadata` (Json, incluye `unit`, `ivaPct`, `priceIncludesIva`, `sourceLabel`, `product`). Comentario: *"Inmutable: nunca se edita, solo se insertan nuevos snapshots"* — append-only, coherente con DOM-01.
- `src/application/macro/capia-sync.ts`: persiste con `source: 'CAPIA'` explícito y `effectiveDate: item.effectiveFrom` — la fecha del dato viaja con el dato, no la del `fetchedAt` del server.
- **Frontera con el motor:** `git grep` de `capia|CAPIA` fuera de `macro/`, `macro.routes.ts`, `macro-sync.worker.ts` y el cliente HTTP solo encuentra una coincidencia en `src/application/cost-structures/cost-period-service.ts`, y es `MacroService.cumulativeInflation` — un indicador de **inflación** (`IPC_NACIONAL`, ya preexistente) usado para contrastar dos períodos cerrados a nivel informativo (`macroContrast`), **no** para alimentar `parametros-costeo-service` ni ningún costo declarado. No hay ningún `write` desde `MacroSnapshot` hacia `ParametroCosteo` o `CostStructure`.

**Limpio.** Sin evidencia de que un precio CAPIA pueda colarse como costo declarado de la empresa. Se re-verifica en pantalla (F4) que `CapiaReferences.tsx` se presente como referencia externa y no como un valor editable/confirmable del costeo.

---

## 2. Mapa de riesgo — PRs del alcance por fuente de riesgo

Clasificación según las tres fuentes de riesgo de la skill (clasificación / base / horizonte). Un PR puede caer en más de una fila si toca más de un riesgo.

### Riesgo MÁXIMO — tocan clasificación fijo/variable, la base de división, o el motor de costeo directamente

| PR (repo) | Qué toca | Por qué es máximo |
|---|---|---|
| 275, 279 (back) | Unidad y escala física por empresa | Precede a #252; si la unidad está mal, TODO lo demás que se muestra en esa unidad está mal |
| 323, 341, 344 (back) / 164 (front) | Unidad de gestión en tablero / resultados | Es el Foco 2. Ya verificado en código (§1); falta F3/F4 con datos reales |
| 338 (back) / 130 (front) | Balance de tanda / pendientes de cierre | Toca qué se considera "cerrado" — riesgo de horizonte |
| 340, 347 (back) / 162 (front) | Módulos de rubro | Puede activar/desactivar secciones del costeo — riesgo de clasificación si un módulo apagado deja un costo sin clasificar y no lo declara |
| 352 (back) / 177 (front) | Precios CAPIA | Es el Foco 3. Ya verificado en código (§1); falta F4 (pantalla) |
| 148 (front) | fix(costeo): usar la clasificación real en el simulador | Título dice literalmente que ANTES no la usaba — candidato directo a R7/cascada de clasificación, revisar el fix en detalle en F3 |
| 153, 154 (front) | Desperdicios y trabajos de terceros del período | Nuevas entradas de costo — riesgo de base (¿sobre qué se prorratean?) |
| 357 (back) | Marcar cargas fuera de rango | Afecta qué dato entra al motor — riesgo de clasificación en el borde |
| 160 (front) | Mostrar los dos costos unitarios | Directamente relacionado con R10 (coherencia aritmética de los unitarios) — riesgo máximo por definición |

### Riesgo ALTO — horizonte / período / plantel

| PR | Qué toca |
|---|---|
| 165 (front), 357 (back) | Panel de campo / cargas fuera de rango — datos de operación diaria que después arrastran al período |
| 344 (back) | Rubro en tablero — decide qué KPIs corresponden a qué horizonte de negocio |
| 334 (back) | Sentry Cron Monitor nightly-learning — no toca costeo, monitoreo de worker |

### Riesgo BAJO / fuera de foco sustantivo — declarado, no se profundiza en F2/F3 salvo que F5/F6 encuentre algo

- Todo el subsistema RAG (305, 306, 307, 308, 310, 311, 312, 313, 314, 315, 316, 318, 320, 325, 327, 330, 331, 333 — backend): ya verificado que no toca el motor (Foco 1). Se audita como **producto de asesoría**, no como motor de costeo — fuera del alcance sustantivo de esta auditoría de costos salvo hallazgos de F5 (reglas de proceso, ej. si el advisor cita mal una cifra).
- CI/chore/deps bumps (276, 339, 343 backend; 131, 134, 136–142, 145–147, 150, 155, 158, 159, 161, 171, 175 frontend): sin riesgo de dominio. Se listan en el marcador de F5 solo si tocan algo de seguridad (ninguno del alcance lo hace, a simple lectura del título).
- 286, 283 (backend — clasificador de escala, términos legales): riesgo bajo para el motor de costeo, aunque 286 es candidato de R1-R4 si se decide ampliar el alcance del clasificador en una próxima tanda.

---

## 3. Qué se audita en F2/F3/F4 — declarado

**F2 (motor puro):** las pruebas P-08 (contribución marginal / punto de equilibrio) y R13 (clasificación incompleta) son las únicas que corren limpio contra funciones puras sin DB — están hechas y PASAN (ver `02-motor.md`). El resto del catálogo (P-01 movimiento de unidades, P-02 producción equivalente, P-03 promedio ponderado y arrastre, P-04 costo modificado/CAUP, P-05 doble verificación de existencia final, P-06 conjuntos, P-07 clasificación/cascada, P-10 desvíos, P-11 coherencia de unitarios, P-12 trazabilidad) están **cableados a `CostPeriodService`, `ProcessCalculationService` y `freezeProcessPeriod`, que importan `PrismaClient` directamente** — no son funciones puras aisladas del resto del sistema como sí lo son `contribucion-marginal.ts` y `punto-equilibrio.ts`. Replicarlas sin DB exigiría inventar un doble de `PrismaClient` fila por fila para cada departamento del fixture (planta, granja, fraccionadora) — un trabajo de mocking tan grande que el resultado dejaría de probar el motor real y pasaría a probar el mock. **Se declaran DIFERIDAS A F3.**

**F3 (backend E2E):** necesita una empresa avícola real sembrada — **bloqueada** (ver hallazgo de entorno abajo). Es la vía correcta para P-01 a P-07 y P-10 a P-12.

**F4 (pantalla):** el "conversor de pesos a cajones" (P-09, error vivo n.º 1) no tiene una función de dominio propia en el backend — se buscó y no existe (`git grep` sin resultados fuera de `unidad-gestion.ts`, que es el factor de unidad, no la división por `cm`). El backend sí expone correctamente `contribucionMarginalPorCajon` ya convertido (`owner-dashboard-service.ts:230-233`, vía `conversor.importeUnitarioDesdeBase`). La composición "importe ÷ cm" es responsabilidad del frontend — **es ahí donde hay que verificar en F4** que divida por `contribucionMarginalPorCajon` y no por `precioPromedioVenta` (que es exactamente el bug que el propio fixture reproduce como contraste: 20,0 cajones en vez de 33,3).

---

## 4. Hallazgo de entorno que bloquea parte de F3

**HALLAZGO-ENT-01 · No hay empresa avícola real sembrada para F3/F4**
`npm run seed:tenant-avicola` no crea empresas — por diseño, solo configura una que ya exista (`--company <uuid>`). La Postgres compartida tiene 544 companies, ninguna avícola: son residuos de corridas de `tests/integration/*` (nombres tipo "Empresa modulos-a"). Crear una requiere pasar por el flujo normal de alta (API/UI) — trabajo de F3, no de este plan. No bloquea F2 (corre contra el fixture puro) ni el resto de F1.

---

## 5. Qué queda declarado fuera de esta tanda

- Verificación línea-por-línea del criterio de aceptación de los 39+34 PRs (F0 ya lo declaró fuera; F1 no lo revierte).
- `CosteAR-admin` (bitácora, panel interno) no se releva salvo que F6 necesite cruzar errores vivos ahí.
- El vertical RAG se trata como producto de asesoría, no de motor — su propia auditoría de calidad (precisión de respuestas, eval:rag) queda fuera del alcance de una auditoría de **costos**.
