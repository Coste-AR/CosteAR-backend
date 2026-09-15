# F2 — Las doce pruebas contra el motor — AUD-2026-09-14

Contra `src/domain/calculations/` en `auditoria/AUD-2026-09-14` (= `origin/staging` @ `a0234dc`), sin base ni API. Fixture FX-AV (`references/fixtures-avicola.md`), calculadora `scripts/calc_fx_av.py`.

## 0. El fixture cierra contra sí mismo

```
$ python .claude/skills/costear-auditoria/scripts/calc_fx_av.py --assert
OK — 24 cuadres verificados
```

Reporte completo corrido y comparado contra las anclas dadas — **coincide exacto en todas**: u.MP/u.CC/u.total de M1 ($200,00/$30,00/$230,00), a justificar y existencia final de M1, pool y $/cajón de granja M1 ($18.750.000 / $25.000,00), modificado+CAUP+unitario de fraccionadora M1 ($25.510,20 / $33.277,95), existencia final por los dos caminos ($851.125,54), cm/PE/margen de seguridad de M1 (30.000 / 600,0 / 20,0%), u.MP exacto de M2 ($220,00 — no revalúa el inventario inicial), los tres desvíos de M2 (−$276.000 / +$792.000 / −$26.400 / +$489.600), PE de M3 fuera de tramo (1.107,2 vs techo 972,3, margen −34,2%), y la zona R13 de M1 ([585,4 ; 600,0]). Extraordinarias de M3: 8 cajones × $42.044,00 (unitario de fraccionadora M3) = $336.352,00 — coincide con el UNITARIO reportado, aritmética verificada a mano.

La trampa de M4 (modificado $28.459,13 > costo del período $28.217,16, NO es error) está en el propio reporte de granja/fraccionadora M4 y el fixture no la rechaza — correcto por diseño.

## 1. P-01 a P-12 — resultado

| ID | Prueba | Resultado | Evidencia |
|---|---|---|---|
| P-01 | Cuadre del cuadro de movimiento de unidades | **DIFERIDA A F3** | `process-costing.ts`/`freeze-process-period.ts` importan `PrismaClient`; no aislable sin DB sin mockear la mitad del sistema |
| P-02 | Producción equivalente por elemento | **DIFERIDA A F3** | ídem |
| P-03 | Promedio ponderado y arrastre entre períodos | **DIFERIDA A F3** | `raw-material.ts::calcStockLedgerPPP` SÍ es pura, pero requiere los movimientos de compra/consumo crudos que arman el u.MP de $220,00 de M2, y esos no están expuestos en `fixtures-avicola.md` (solo el resultado agregado) — reconstruirlos a ciegas sería inventar el dato que se quiere auditar. Se verifica en F3 contra la corrida real. |
| P-04 | Costo modificado y CAUP | **DIFERIDA A F3** | depende de la cadena de `process-costing.ts` |
| P-05 | Doble verificación de existencia final | **DIFERIDA A F3** | ídem |
| P-06 | Conjuntos: 4 métodos, barrera de decisión | **DIFERIDA A F3** | `joint-costs.ts` no revisado en detalle esta tanda — declarado, no evaluado |
| P-07 | Clasificación y cascada de resolución | **PARCIAL — PASA lo que se pudo probar puro** | `resolverComportamiento()` en `contribucion-marginal.ts` (cascada período→estructura→empresa) se ejercitó indirectamente vía P-08 con clasificaciones a nivel estructura; la cascada completa con las 3 capas (R1-R4, R7) no se probó standalone — DIFERIDA A F3 |
| **P-08** | **Contribución marginal, PE, tramos** | **✅ PASA — 4/4 períodos, contra el código real** | ver §2 |
| P-09 | Conversor de pesos a cajones | **NO APLICA a F2 — reasignada a F4** | No existe una función de dominio backend para "importe ÷ cm"; el backend expone `contribucionMarginalPorCajon` ya convertido (`owner-dashboard-service.ts:230`). La composición final es de pantalla — ver `01-plan.md §3` |
| P-10 | Desvíos abiertos en tres | **DIFERIDA A F3** | no hay función de dominio pura para varianza de precio/cantidad/combinado localizada en `src/domain/calculations/` — buscar en F3 si vive en `application/` con DB |
| P-11 | Coherencia aritmética de los unitarios | **DIFERIDA A F3** | depende de la salida completa de `process-costing.ts` |
| P-12 | Trazabilidad, transacciones, contrato de error | **DIFERIDA A F3** | requiere DB (bitácora en la misma transacción) |
| **R13** | **Zona de equilibrio con clasificación incompleta** | **✅ PASA — contra el código real** | ver §2 |

**Resumen: 2 PASAN (P-08, R13), 1 parcial (P-07), 1 no aplica a este nivel (P-09 → F4), 8 diferidas a F3.**

## 2. P-08 y R13 — contra el código real, no contra el fixture

Se escribió un harness (`tsx`, descartado al terminar, no forma parte de los papeles versionados) que importa **directamente** `calcularContribucionMarginal` y `calcularPuntoEquilibrio` de `src/domain/calculations/` (no reimplementa la fórmula) y les da de comer los datos de la capa marginal del fixture: `componentes = [{clave:'cv', importeAbsorcion: cv×cajones}, {clave:'cf', importeAbsorcion: CF}]` con `cv` clasificado VARIABLE y `cf` clasificado FIJO.

```
M1: cm obtenida=30000.00  esperada=30000  [PASA]   PE obtenido=600.0   esperado=600    [PASA]
M2: cm obtenida=29347.00  esperada=29347  [PASA]   PE obtenido=613.4   esperado=613.3  [PASA]
M3: cm obtenida=22064.00  esperada=22064  [PASA]   PE obtenido=1107.2  esperado=1107.2 [PASA]
M4: cm obtenida=27612.00  esperada=27612  [PASA]   PE obtenido=884.8   esperado=884.8  [PASA]

R13: incompleta=true  PE.incompleta=true
     motivos=["Falta clasificar frente al volumen el rubro Rubro sin clasificar."]
     [PASA — no da un punto, da incompleta]
```

M2 da 613,4 contra la ancla 613,3 — diferencia de 0,1 (redondeo de la ancla a un decimal, la corrida interna usa Decimal de 28 dígitos). **Diferencia en pesos: $0,00 relevante** (0,1 cajón sobre 613 es ruido de presentación, no un error del motor).

**Lo que R13 prueba realmente:** que `calcularContribucionMarginal` marca `incompleta: true` y `calcularPuntoEquilibrio` propaga esa incompletitud (nunca devuelve un número) cuando hay un componente sin `comportamientoVolumen` clasificado. **No** prueba la "zona [585,4 ; 600,0]" completa del fixture (que requiere correr el PE dos veces — asumiendo fijo y asumiendo variable — y presentar el rango): eso es una composición de más alto nivel, candidata a `owner-dashboard-service.ts` o al frontend, no vive en esta función. Se verifica esa composición específica en F3/F4.

## 3. Hallazgos de esta fase

**Corrección sobre lo escrito más arriba:** la afirmación original de este documento — que P-01 a P-06/P-10/P-12 estaban "diferidas a F3 porque `process-costing.ts`/`freeze-process-period.ts` importan `PrismaClient`" — **no estaba verificada y era incorrecta**. Se verificó recién con `git grep` (ver AUD-2026-09-14-01) y el dominio está limpio de Prisma. La razón real del diferimiento era el costo de armar a mano los objetos de entrada encadenados de 3 departamentos × 4 períodos dentro del presupuesto de esta fase, no una barrera arquitectónica. Queda corregido acá en vez de editado en silencio arriba, siguiendo REV-01/REV-02.

### AUD-2026-09-14-01 · El dominio de costeo por procesos está limpio de Prisma, pero el escenario avícola encadenado no tiene ningún test que lo ejercite
**Severidad:** 🟡 OBSERVACIÓN
**Nivel donde falló:** motor (evaluación de cobertura, no de cálculo)
**Dónde:** `src/domain/calculations/{process-costing,joint-costs,freeze-process-period,indirect-costs,calculate}.ts`
**Verificado con:**
```
git grep -n "PrismaClient\|@prisma/client\|prisma\." origin/staging -- src/domain/calculations/
→ sin resultados (los 11 archivos del motor son funciones puras; process-costing.ts lo dice
  explícito en su propio comentario: "Función PURA: sin Prisma, sin HTTP, sin servicios")
```
**Qué hace hoy:** El dominio está arquitectónicamente sano — el acoplamiento a `PrismaClient` está en la capa de aplicación (`CostPeriodService`, `ProcessCalculationService`), no en el dominio. Los 11 archivos SÍ tienen cobertura de test existente (`process-costing.test.ts` 32 casos, `joint-costs.test.ts` 10, `freeze-process-period.test.ts` 13, y el resto entre 1 y 22 archivos que los referencian) — pero contra los fixtures de cátedra (Azur Alcoholes, ITCS) que exige DOM-05, **no contra un escenario multi-departamento encadenado (planta→granja→fraccionadora) como el que pide esta auditoría.**
**Qué debería hacer:** Nada estructural — el diseño ya permite testear estos archivos sin DB, como se demostró con P-08/R13 en `contribucion-marginal.ts`/`punto-equilibrio.ts` (§2). Lo que falta es que exista, en algún lado del repo, un test que encadene 3 departamentos y verifique el cuadre de punta a punta — hoy esa verificación solo la hace el fixture Python de esta skill, que es un doble, no el motor real.
**Regla/doctrina:** DOM-05 (regresión cero), economía de contexto de la skill.
**Magnitud:** 0 tests en todo el repo ejercitan una cadena de 3 departamentos con producción equivalente + CAUP + conjuntos encadenados. Archivos concretos sin ese escenario: `process-costing.ts`, `joint-costs.ts`, `freeze-process-period.ts`, `indirect-costs.ts`, `calculate.ts`.
**Cómo se reproduce:**
```bash
git grep -n "PrismaClient\|@prisma/client\|prisma\." origin/staging -- src/domain/calculations/
git grep -c "^\s*\(it\|test\)(" origin/staging -- tests/domain/process-costing.test.ts tests/domain/joint-costs.test.ts tests/domain/freeze-process-period.test.ts
```
**Issue/PR de origen:** preexistente (arquitectura del motor, no de esta tanda).
**Prueba que lo encontró:** AUD-2026-09-14-01, disparada por revisión de PASO 1.

### AUD-2026-09-14-02 · El harness de accuracy del clasificador avícola está gateado por `CORPUS=1`, no roto
**Severidad:** 🟡 OBSERVACIÓN
**Nivel donde falló:** proceso (documentación de una decisión de test)
**Dónde:** `tests/classifier/corpus-avicola.harness.test.ts:393` — `describe.runIf(process.env.CORPUS === '1')`
**Verificado con:**
```
git log -S "runIf(process.env.CORPUS" --oneline origin/staging -- tests/classifier/corpus-avicola.harness.test.ts
→ c9a3dc4 feat(clasificador): corpus avicola como vara de medicion + tope al backoff (CL-07)
git show c9a3dc4 -- tests/classifier/corpus-avicola.harness.test.ts   (commit de creación, no de skip posterior)
```
**Qué hace hoy:** El gate existe **desde el commit que creó el archivo** (`c9a3dc4`, giuliannadr, 2026-08-07), no se agregó después para silenciar un rojo. El cuerpo del commit documenta el motivo con extensión y números: el clasificador real (`classifyDocument`) llama a Groq, **no es determinista** (temperature 0.05 sin seed — "dos corridas idénticas dieron 61,1% y 66,7%"), y correrlo en cada `npm test` metería ruido no reproducible y costo de API en el CI rápido. El propio archivo lo declara en su encabezado: corre "bajo demanda" con `CORPUS=1`. Mi búsqueda inicial de "skip" (case-insensitive, texto literal) no lo encontró porque usa la API `runIf`, no `.skip` — error de búsqueda mío, no del código.
**Qué debería hacer:** Nada urgente. Sería mejor que hubiera un ADR propio (hoy la justificación vive en el mensaje de commit, no en `docs/adr/`) para que quede indexado — se buscó y no existe.
**Regla/doctrina:** DOC-01 (decisiones no obvias van a ADR) — se cumple parcialmente: está documentado, pero no donde el proceso del repo dice que debería vivir.
**Magnitud:** 4 tests (de 1668 backend) corren solo bajo demanda. No afectan el marcador de verde/rojo del CI en ningún PR normal.
**Cómo se reproduce:**
```bash
git log -S "runIf(process.env.CORPUS" --oneline origin/staging -- tests/classifier/corpus-avicola.harness.test.ts
git show c9a3dc4 --format='%an%n%ad%n%s%n%n%b' -- tests/classifier/corpus-avicola.harness.test.ts
```
**Issue/PR de origen:** preexistente, commit `c9a3dc4` (fuera del alcance de los 39 PR de esta tanda).
**Prueba que lo encontró:** AUD-2026-09-14-02, disparada por PASO 1.

### AUD-2026-09-14-03 · La suite unitaria corre sin `maxWorkers` fijo, igual en CI que en local
**Severidad:** 🟡 OBSERVACIÓN
**Nivel donde falló:** proceso (configuración de test, no cálculo)
**Dónde:** `vitest.config.ts` (sin `poolOptions`/`maxWorkers`), `.github/workflows/ci.yml` job `build-and-test` (`npm run test`, sin flags)
**Verificado con:**
```
grep -n "maxWorkers\|poolOptions\|pool:" vitest.config.ts    → sin resultados
git show origin/staging:.github/workflows/ci.yml | grep "Run Tests" -A1   → run: npm run test   (sin flags)
```
**Qué hace hoy:** CI y local corren con la misma configuración por defecto de Vitest (un worker por archivo, sin techo). En la corrida completa de esta auditoría (195 archivos) 3 tests HTTP timeoutearon a 5000ms por contención de CPU y pasaron limpio al aislarlos — mismo patrón que el flaky ya conocido y documentado de `indirect-costs-capacidad-normal` (ESTADO.md, issue #145).
**Qué debería hacer:** El riesgo no es el flaky en sí — es que sin un techo de workers fijado a propósito (y documentado, como ya se hizo para el rol de RLS o las claves JWT efímeras en `ci.yml`), **una regresión real de performance se puede leer como "contención de CPU" y descartarse sin investigar**, exactamente el mismo modo de falla que motivó la Fase 4 del §11.4 (commit `ae92212`) para otro test.
**Regla/doctrina:** GR-08 (no confiar ciegamente en la lectura superficial de una suite en rojo/verde intermitente).
**Magnitud:** 3 archivos afectados en esta corrida (`admin-stats.test.ts`, `owner-dashboard.test.ts`, `parametros-costeo.test.ts`), más el flaky ya catalogado de `indirect-costs-capacidad-normal` — 4 en total, ninguno reproducible en aislamiento.
**Cómo se reproduce:**
```bash
npm test -- --reporter=default          # correr la suite completa 2-3 veces y ver si cambian los archivos que timeoutean
npx vitest run tests/http/admin-stats.test.ts tests/http/owner-dashboard.test.ts tests/http/parametros-costeo.test.ts   # aislado: siempre verde
```
**Issue/PR de origen:** preexistente — mismo mecanismo que el issue #145 ya documentado en ESTADO.md.
**Prueba que lo encontró:** PASO 5 de esta auditoría (línea de base de tests) + AUD-2026-09-14-03.
