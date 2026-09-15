# F3 — Backend E2E — AUD-2026-09-14

Contra el servidor real (`npm run dev`, rama `auditoria/AUD-2026-09-14` = `origin/staging` @ `a0234dc`), atravesando API + Postgres real (`localhost:5433`). Registro real por `/auth/register`, nada insertado a mano en la base.

## 0. Alcance cargado — declarado

**M1 completo y cerrado (Granja + Fraccionadora, contaminado por AUD-04a en Fraccionadora). P-07 reproducido — 🔴 CONFIRMADO. P-12 aislamiento entre empresas — verificado, PASA.**

**No se cargaron M2, M3 ni M4 del proceso Granja→Fraccionadora**, ni el reparto de costos conjuntos (joint-costs), ni los desvíos vía API (P-10). Motivo declarado, no silencio: **AUD-2026-09-14-04a bloquea el cierre de cualquier período de Fraccionadora que use la conversión huevo→cajón correcta** — cargar M2/M3/M4 exigiría repetir el mismo workaround de M1 en cada uno, y la contaminación se acumularía período sobre período (la existencia final contaminada de M1 pasaría a ser la existencia inicial de M2, etc.), sin producir ninguna cifra verificable contra el fixture. Se priorizó, con el tiempo restante, reproducir dos ítems de mayor severidad potencial y menor costo de investigación: **P-07** (podía ser 🔴, y lo fue) y el **aislamiento entre empresas** de P-12 (reutiliza un patrón ya probado, bajo costo). Granja sola (sin Fraccionadora) SÍ es reproducible limpia en cualquier período — no se repitió para M2-M4 por presupuesto de esta tanda, no por bloqueo técnico.

## 1. Decisión de modelado — declarada (REV-03)

**La "Planta de alimento" del fixture NO se modela como tercer departamento encadenado.** El endpoint de unit-movement de Procesos recibe el costo de MP/MO/CIF de cada departamento como **montos agregados** (`periodCostMp/Mo/Cif`), no como una ficha de movimientos PPP — eso es lo que hace `/cost-structures/:id/raw-material`, que es de **Costeo por Órdenes**, no de Procesos. Modelar Planta como un departamento encadenado exigiría que "kg de alimento" se convirtiera en "huevos" por un factor fijo, y esa relación no es una conversión de unidad física (es una relación biológica, no lineal) — el propio fixture lo dice en su diagrama (§1 de `fixtures-avicola.md`): la ÚNICA conversión de unidad declarada es huevo→cajón.

**Lo que se cargó en su lugar:** una cadena de 2 departamentos, **Granja (huevo, secuencia 1) → Fraccionadora (cajón, secuencia 2)**, y el costo del alimento consumido por Granja se cargó como `periodCostMp` ya multiplicado (36.000 kg × $230,00 = $8.280.000, verificado contra el motor puro de Planta en F2 — P-03 de Planta en sí no se corrió contra la API). Esto es fiel a los números del fixture pero **no prueba que el sistema tenga un camino para llevar el costo de una estructura de Planta hacia el `periodCostMp` de Granja automáticamente** — hoy ese número lo escribiría un costista a mano, sin trazabilidad hacia la ficha de stock que lo originó. Se anota como observación de UX/trazabilidad, no como hallazgo formal de esta tanda (no estaba en el alcance de los 39+34 PR).

**Split MOD/CIF de Granja:** el fixture da el "pool" total ($18.750.000 en M1) y la lista de componentes (alimento, MOD, amortización, CIP fijo, CV granja) pero no el monto de MOD por separado. Se cargó `periodCostMo: 0` y `periodCostCif: 10.470.000` (= pool − alimento), preservando el TOTAL exacto. La composición interna MOD/CIF específica queda sin verificar — no afecta ningún assert de este fixture (P-08 y el marcador de fijo/variable no dependen de esa subdivisión a este nivel).

## 2. Endpoints usados (mapa completo de Costeo por Procesos)

Ninguno faltó — el flujo completo de alta + Procesos tiene camino de API de punta a punta:

| Paso | Endpoint | Resultado |
|---|---|---|
| Términos vigentes | `GET /terms/current` | 200 |
| Alta de usuario | `POST /auth/register` | 201 |
| Login | `POST /auth/login` | 200 |
| Alta de empresa | `POST /companies` | 201 |
| Alta de estructura | `POST /companies/:id/cost-structures` (`costingSystem: 'PROCESSES'`) | 201 |
| Setup de departamentos | `POST /structures/:id/process-setup` | 200 |
| Listar departamentos | `GET /structures/:id/process/departments` | 200 |
| Abrir período | `POST /structures/:id/periods` (`carryAmounts`) | 201 |
| Cuadro de movimiento por depto/período | `PUT /structures/:id/process/departments/:deptId/periods/:periodId/movement` | 200 |
| Calcular y persistir la corrida | `POST /structures/:id/process/periods/:periodId/calculate` | 200 |
| Cerrar período | `POST /periods/:id/close` | 200 |

No usados en esta pasada (documentados por lectura de código, no ejercitados): `GET .../equivalent-production`, `PUT/GET .../joint-costs`, `GET .../production-report`, `POST /periods/:id/reopen`, `PUT/PATCH/DELETE/order` de departamentos.

## 3. Hallazgos reales encontrados en el camino

**Corrección de proceso, antes de las fichas:** la primera versión de este documento decía que el 422 ocurría en el `PUT .../movement` de Fraccionadora. Es **incorrecto** — quedó mal atribuido porque esa corrida pegó, sin que yo lo verificara, contra un proceso `node` en el puerto 3000 que **ya estaba corriendo de otra sesión** (`netstat -ano` lo confirmó: PID preexistente, no el que arrancó `npm run dev` en este turno — el log mostraba `EADDRINUSE` en el intento propio, señal que pasé por alto). Se relanzó el servidor en el puerto **3001**, arrancado y confirmado por esta sesión desde `auditoria/AUD-2026-09-14`, y se repitió la corrida completa: **los números finales de M1 son idénticos** (ver §4), pero el paso donde revienta es `POST .../calculate`, no el `PUT .../movement` — el PUT guarda `750` sin protestar; el cruce contra lo que transfirió Granja se hace recién al calcular. El archivo de evidencia (`evidencia/f3-m1-script.mjs`) ya apunta al puerto 3001.

### AUD-2026-09-14-04a · La conversión entre unidades se modela como factor decimal, y las unidades de este rubro no son representables
**Severidad:** 🔴 CRÍTICO — bloquea la promoción
**Nivel donde falló:** backend (Costeo por Procesos — validación cruzada al calcular)
**Dónde:** `prisma/schema.prisma:1749` — `conversionFromPrevious Decimal? @db.Decimal(18, 6)`
**Verificado con:** reproducido en vivo, dos veces, contra dos procesos de servidor distintos (puerto 3000 preexistente y puerto 3001 arrancado y confirmado en esta sesión — mismo resultado en los dos):
```bash
POST /structures/:id/process-setup
  { departments: [..., { name:'Fraccionadora', sequence:2, unit:'cajon', conversionFromPrevious: 1/360 }] }
GET /structures/:id/process-setup   →  conversionFromPrevious guardado: 0.002778   (no 0.002777...)
PUT .../Fraccionadora/periods/:id/movement { receivedFromPrevious: 750, ... }  →  200 OK (el PUT no cruza-valida)
POST .../periods/:id/calculate
→ 422 MISSING_INPUT
"«Granja» transfirió 270000 unidades pero en «Fraccionadora» cargaste que recibió 750.
 Se esperaban 750.0600000000001 (270000 × factor 0.002778 = 750.0600000000001).
 Faltan 0.06000000000005912 unidades..."
```
**Qué hace hoy:** `1/360 = 0,00277̄7` (periódica) se redondea a `0,002778` al guardarse en `Decimal(18,6)`, y `270.000 × 0,002778 = 750,06` en vez de `750,00`. **No es un problema de escala de la columna.** Se probaron en vivo las TRES conversiones que arma este rubro (huevo→maple 1/30, maple→cajón 1/12, huevo→cajón 1/360): las tres son periódicas en base 10 (`0,0333...`, `0,08333...`, `0,002777...`) y las tres se truncan al guardarse. Subir la columna a `Decimal(18,10)` no elimina el error, solo lo corre de lugar (con 10.000 huevos de escala en vez de 270.000 alcanzaría de nuevo). **El arreglo correcto es modelar la conversión como razón entera** (`unidades base por unidad`, ej. `360`, `30`, `12`), no como multiplicador decimal — exactamente el patrón que `UnidadMedida.factor` ya usa en otra parte del mismo repo (ver §5, concepto duplicado).
**Fundamento de la severidad:** bloquea el cierre de período del 100% de las avícolas de postura — el vertical de foco exclusivo del producto y el del cliente piloto. Una empresa de este rubro no puede cerrar NINGÚN período de Costeo por Procesos con la conversión declarada correctamente. Bloquea la promoción.
**Regla/doctrina:** §1 de `fixtures-avicola.md`: *"La conversión huevo → cajón se hace antes de todo cálculo. Si el motor tiene 'cajon' hardcodeado en capa 1, acá se ve."* No estaba hardcodeado — está peor: ninguna conversión no entera de este rubro es representable.
**Magnitud:** los tres eslabones de la cadena de unidades del rubro (huevo→maple, maple→cajón, huevo→cajón) fallan. Confirmado en vivo, no solo en 360.
**Cómo se reproduce:** `node docs/auditorias/AUD-2026-09-14/evidencia/f3-m1-script.mjs` (usa el workaround `750,06`; revertir a `750` para ver el 422).
**Issue/PR de origen:** preexistente (migración `20260803120000_add_process_department_unit`, fuera del alcance de los 39+34 PR de F0).
**Prueba que lo encontró:** P-01 de F3.

### AUD-2026-09-14-04b · La validación cruzada exige coincidencia exacta sobre un número que por construcción viene redondeado
**Severidad:** 🟠 GRAVE — independiente de 04a
**Nivel donde falló:** backend, `src/application/cost-structures/validate-inputs.ts`
**Dónde:** `validate-inputs.ts:293` (`const esperadas = transferidas * factor;`) y `validate-inputs.ts:296` (`if (Math.abs(diferencia) > 1e-4)`) — comparación con operador `Math.abs(...) > 1e-4`, tolerancia absoluta fija de 0,0001 unidades.
**Qué hace hoy:** hay tolerancia (no exige bit-a-bit), pero es una **tolerancia absoluta fija**, no relativa a la escala de la cantidad. Con factor ya redondeado a 6 decimales y una producción de 270.000 unidades, el error de redondeo del factor (≈0,0000002777 por unidad) se amplifica a 0,06 — 600 veces más grande que la tolerancia de 0,0001. La misma tolerancia que alcanza para una carga de 100 unidades se queda corta en cualquier escala real de producción industrial.
**Qué debería hacer:** tolerancia relativa a la magnitud (ej. un epsilon proporcional a `transferidas`), o redondear `esperadas`/`recibidas` a la unidad entera antes de comparar cuando la unidad de destino no admite fracciones (no hay 0,06 de un cajón).
**Regla/doctrina:** consecuencia directa de 04a — aunque se resuelva el modelo de factor (04a), una validación sin tolerancia proporcional seguiría rechazando cargas válidas a cualquier escala grande.
**Magnitud:** cualquier cadena con factor no exacto y producción de escala industrial (cientos o miles de unidades).
**Issue/PR de origen:** preexistente.
**Prueba que lo encontró:** misma reproducción que 04a.

**Workaround aplicado para poder seguir auditando el resto de M1** (declarado, no oculto): se cargó `receivedFromPrevious: 750,06` y `finalWip: 30,06` (en vez de 750 y 30) para que `calculate` no rechazara el período. Esto **contamina** cada número downstream de Fraccionadora en ~0,008%–0,2% — ver §4, separado explícitamente entre lo que esto contamina y lo que no.

### 🔎 Camino alternativo probado en vivo: ¿acepta la razón entera al revés?
Se cargó **M1 completo** (Granja + Fraccionadora, los mismos datos reales) con `conversionFromPrevious: 360` (entero, sin invertir) en vez de `1/360`. El `PUT` de setup lo acepta sin error — no valida que el factor "tenga sentido" en ese momento. Pero al calcular:
```
POST calculate → 422 MISSING_INPUT
"«Granja» transfirió 270000 unidades pero en «Fraccionadora» cargaste que recibió 750.
 Se esperaban 97.200.000 (270000 × factor 360 = 97.200.000). Faltan 97.199.250 unidades..."
```
**No es un camino alternativo válido — confirmado en vivo, no solo por lectura de la fórmula del motor.** `360` entero invierte la conversión (multiplica en vez de dividir) y pide una cantidad absurda. La única forma de declarar esta conversión hoy es el decimal periódico que rompe en 04a.

## 5. El concepto duplicado — por qué esto es un defecto de diseño, no un bug aislado

```
$ git grep -n "UnidadMedida" origin/staging -- prisma/schema.prisma | grep -A3 "model UnidadMedida"
factor Decimal @default(1) @db.Decimal(18, 6)
/** Cuántas unidades BASE entran en UNA de esta. Cajón sobre huevo = 360. */
```

**`UnidadMedida.factor` (línea ~2205 de `schema.prisma`) ya modela exactamente esta relación, y la modela bien**: es "cuántas unidades BASE entran en UNA de ésta" — 360 para cajón sobre huevo, **un entero conceptual** (aunque la columna también sea `Decimal(18,6)`, el valor 360 en sí es exacto, no periódico, porque la dirección de la razón es la que no genera fracción). Se usa en `company-service.ts`, `deposito-service.ts`, `venta-producto-service.ts`, `parametros-costeo-service.ts` — todo el resto del sistema que necesita convertir unidades pasa por acá.

**`git grep -n "UnidadMedida" -- src/application/cost-structures/process-costing` no devuelve NADA.** El motor de Costeo por Procesos **no usa `UnidadMedida` en absoluto** — tiene su propio campo (`ProcessDepartment.conversionFromPrevious`), con su propia semántica (inversa: "unidades nuevas por unidad recibida", no "unidades base por unidad") y su propia representación (decimal libre, no ligada a ninguna unidad ya declarada por la empresa en `UnidadMedida`).

**Esto es un mismo concepto modelado dos veces en el mismo repo, uno correcto (entero, ya usado y probado en el resto del sistema) y uno roto (decimal, sin relación con el primero).** El costista que ya declaró en `UnidadMedida` que 1 cajón = 360 huevos tiene que volver a declarar esa misma razón, a mano, como un decimal, en el setup de Procesos — y ese segundo camino es el que falla.

## 6. Por qué llegó a `staging` sin que nadie lo viera — cadena causal

```
$ git grep -n "conversionFromPrevious" origin/staging -- prisma tests test
tests/application/process-calculation-service.test.ts:216   conversionFromPrevious: 500
tests/application/process-setup-service.test.ts:61           conversionFromPrevious: 999
tests/application/process-setup-service.test.ts:62           conversionFromPrevious: 550
tests/application/unidades-entre-departamentos-motor.test.ts:57,91   conversionFromPrevious: 500
tests/application/unidades-entre-departamentos.test.ts:126,131,147   conversionFromPrevious: 10, 10, 1
tests/domain/setup-rules.test.ts:82                          conversionFromPrevious: 550
```

**Todos los factores de todos los tests existentes son enteros exactos en `Decimal(18,6)`: 500, 999, 550, 10, 1.** Ninguno es periódico. El caso de ancla del propio dominio (comentario de H12 en `validate-inputs.ts`) es "1 tonelada de fruta → 550 litros de jugo" — también entero. **Ningún test, seed ni fixture existente ejercitó jamás una conversión que no sea un número entero limpio**, y 1/360 (el que define el rubro avícola, el único cliente piloto del producto) es el primero.

Esto encadena con **AUD-2026-09-14-01** (el motor de procesos es arquitectónicamente testeable sin base, pero nada lo ejercita con el escenario real del rubro) de una forma muy concreta: **motor puro y testeable + cero tests con un factor no entero + seeds que tampoco lo ejercitan = el defecto llegó hasta `staging` sin que ni un test rojo lo hubiera podido atajar.** No es que faltara cobertura en general — es que la única cobertura que hubiera importado (un factor periódico, a la escala de una producción real) nunca se escribió, en ningún nivel: ni motor puro, ni servicio, ni E2E.

## 4. M1 — qué quedó VERIFICADO y qué quedó NO VERIFICADO

Todo lo cargado con `receivedFromPrevious: 750,06`/`finalWip: 30,06` (el workaround de AUD-2026-09-14-04) está **contaminado** en cualquier magnitud absoluta que dependa de esos dos números. Separado explícitamente, sin promediar ni suavizar:

### ✅ VERIFICADO — identidades invariantes de escala (valen igual con el input corrido, porque comparan el motor contra sí mismo, no contra un número externo)

- **Identidad CAUP** `(UAJ−PN) × (modificado+CAUP) = costo total del departamento anterior`: `735,0588 × 25.508,16 = 18.750.000` **exacto**, igual al `costoTotal` que el propio departamento anterior reporta. Esta identidad cierra **para cualquier UAJ que se use**, contaminado o no — es una propiedad algebraica del motor, no depende de que UAJ sea 750 o 750,06. **PASA.**
- **Existencia final por los dos caminos** (P-05): `costoExistenciaFinalPorDiferencia` y `valuacionExistenciaFinalPorElemento` — el motor devuelve el mismo número, `852.762,3866328793`, por los dos caminos, con `ajustePorRedondeo: -6,9e-21` (cero). Que los dos caminos COINCIDAN ENTRE SÍ no depende del input estar contaminado — solo depende de que el motor sea internamente consistente. **PASA.**
- **CAUP ausente en el departamento 1**: la respuesta de Granja no tiene ninguna clave `transferredCost`/`caup` — el campo ni existe para secuencia 1. No depende de ninguna magnitud. **PASA.**
- **Pérdidas extraordinarias separadas del costo del producto**: `costoPerdidasExtraordinarias` es una línea aparte de `costoTerminadasYTransferidas`, nunca se suma al costo unitario transferido. Estructural, no depende de la magnitud exacta. **PASA — coincide con la doctrina del fixture.**
- **Producción equivalente abierta por elemento** (P-02): tres columnas separadas — "departamento anterior" (100%, EF incluida), maples (0% en EF), CC (60% en EF) — existen y se calculan con avances distintos, tal como pide la doctrina. La APERTURA en 3 elementos con sus 3 avances distintos es correcta estructuralmente; los valores exactos de cada columna sí están contaminados (ver abajo).
- **Cuadre de unidades** (P-01): `totalToAccount = totalAccounted` en los dos departamentos — la identidad "a justificar = justificadas" cierra sea cual sea el número que se cargó, porque es tautológica sobre el propio input declarado. **PASA como mecanismo**, no como prueba de que el número cargado sea el correcto (eso lo bloquea 04a).

### ❌ NO VERIFICADO — anclas absolutas del fixture, medidas con un input contaminado (no es "PASA con desvío", es que no se pudo comparar exacto)

| Métrica | Motor real (con workaround) | Ancla del fixture |
|---|---:|---:|
| Costo modificado | $24.998,00 | $25.000,00 |
| CAUP | $510,16 | $510,20 |
| Departamento anterior ajustado | $25.508,16 | $25.510,20 |
| Unitario total fraccionadora | $33.275,69 | $33.277,95 |
| A justificar | $24.312.083,00 | $24.312.080,00 |
| Existencia final (valor absoluto) | $852.762,39 | $851.125,54 |
| Producción equivalente MP (maples) | 704,9988 | 705 |
| Producción equivalente CC | 723,0348 | 723 |
| Producción equivalente dpto. anterior | 735,0588 | 735 |

Estas nueve filas quedan **NO VERIFICADO** hasta que AUD-2026-09-14-04 se corrija y M1 se pueda cargar con los valores reales (750 y 30, sin fudge). No se recalculan "a mano" para forzar una comparación exacta — sería inventar el número que se quiere auditar.

## 5.bis P-07 — el chequeo del período cerrado (error vivo n.º 5) — REPRODUCIDO

### AUD-2026-09-14-05 · Un período cerrado resuelve su clasificación de costos contra el valor VIGENTE, no contra el que tenía cuando se cerró
**Severidad:** 🔴 CRÍTICO
**Nivel donde falló:** backend, `ParametrosCosteoService` / cascada de `resolverComportamiento`
**Dónde:** `GET /companies/:companyId/parametros-costeo/:clave?periodId=X` — resuelve en vivo contra la tabla `ParametroCosteo` actual, no contra una foto tomada al cerrar el período.
**Verificado con** (reproducido en vivo, estructura ORDERS mínima, `docs/auditorias/AUD-2026-09-14/evidencia/p07-periodo-cerrado.mjs`):
```
1. Empresa nueva. Clasificación empresa-wide de "comportamiento_materia_prima" = FIJO.
2. Abrir M1. GET clasificación para M1 -> FIJO. ✓ (correcto en ese momento)
3. Completar M1 (raw-material/direct-labor/indirect-costs/sales), calcular, CERRAR M1. -> 200
4. Abrir M2 (queda como período abierto).
5. Reclasificar la MISMA clave, empresa-wide: VARIABLE. (M1 sigue cerrado, no se tocó)
6. GET clasificación para M1 (CERRADO) -> "VARIABLE"
```
**Qué hace hoy:** la cascada período→estructura→empresa de `resolverComportamiento` (verificada pura en F2, P-08) es correcta EN SÍ MISMA, pero la fila que resuelve al nivel "empresa" (`periodId: null`) es una fila viva, mutable, y **no hay ninguna instantánea tomada al cerrar el período** que la reemplace. Cualquier cambio a una clasificación empresa-wide se propaga instantáneamente a TODOS los períodos cerrados que dependían de ella por cascada — no solo al que está abierto.
**Qué debería hacer:** al cerrar un período, la clasificación resuelta en ese momento (para cada clave que participó del cálculo) tiene que congelarse como una fila con `periodId` propio (o en el snapshot del resultado), de forma que reclasificar a nivel empresa después nunca le cambie el pasado a un período ya cerrado.
**Regla/doctrina:** exactamente el error vivo n.º 5 del mapa del código, y el principio general de DOM-01 (append-only / nada se pisa) aplicado a la vista de costeo variable, no solo a los valores absolutos.
**Magnitud:** cualquier reclasificación empresa-wide después de cerrar un período le cambia retroactivamente la contribución marginal y el punto de equilibrio a TODOS los períodos cerrados anteriores que no tengan su propia fila period-scoped — sin ninguna alerta, sin ningún registro de que pasó. No se midió el desvío en pesos porque la prueba usó una estructura mínima (no el fixture FX-AV); la mecánica del bug no depende de la magnitud de los importes.
**Cómo se reproduce:** `node docs/auditorias/AUD-2026-09-14/evidencia/p07-periodo-cerrado.mjs`
**Issue/PR de origen:** preexistente — `parametros-costeo-service.ts` no cambió en los 39 PR del alcance de F0 (no aparece en el diffstat de `07415de..origin/staging`).
**Prueba que lo encontró:** PASO 4 del pedido de esta auditoría, P-07.

## 5.ter P-12 — aislamiento entre empresas

Reproducido en vivo (`evidencia/p12-aislamiento.mjs`): usuario B intenta leer la empresa, la estructura y los departamentos de proceso del usuario A por sus IDs reales (no adivinados, los IDs verdaderos que devolvió la API al crearlos). Los tres caminos devuelven `404 NOT_FOUND` — nunca revela que el recurso existe. **PASA.**

No verificado en esta tanda dentro de P-12: bitácora en la misma transacción forzando un fallo real (necesitaría inyectar un error a mitad de una transacción, no se intentó), `MissingInputError` con capacidad normal en cero (no se cargó ese escenario), `late_data_decisions` en los caminos nuevos de esta tanda (RAG/CAPIA/unidad de gestión/módulos de rubro — ninguno de esos caminos se ejercitó en F3). Sí se observó, sin ser el foco de una prueba dedicada: **ningún 500 crudo** en ninguna de las ~20 respuestas de error recibidas a lo largo de esta fase (siempre `{error:{code,message}}` con 4xx) — consistente con DOM-04, no exhaustivo.

## 5.quater P-06 y P-10 — no ejercitados

**P-06 (conjuntos):** no se cargó ni una vez. `PUT /structures/:id/process/periods/:periodId/joint-costs` está mapeado y leído (§2), pero no invocado. No se puede afirmar ni PASA ni FALLA — **DIFERIDA**, presupuesto de esta tanda.

**P-10 (desvíos):** no se localizó un endpoint HTTP dedicado a desvíos de precio/cantidad en el mapa de rutas revisado (`grep` de `desvio\|deviation` en `src/infrastructure/http/routes/` no se corrió a fondo esta tanda). Existe `desperdicio.routes.ts` (desperdicios, concepto distinto) y `tests/application/deviation-service.test.ts` (capa de aplicación, sin ruta HTTP confirmada). **NO VERIFICADO si existe camino de API** — a diferencia de los demás ítems diferidos, este necesita una vuelta de reconocimiento de rutas antes de poder cargar nada, no solo tiempo de carga de datos.

## 5. P-01 a P-12 — estado consolidado de esta tanda

| ID | Prueba | Resultado |
|---|---|---|
| P-01 | Cuadre del cuadro de movimiento | ✅ VERIFICADO como mecanismo (M1) — el "a justificar = justificadas" cierra; el NÚMERO cargado en Fraccionadora está contaminado por AUD-04a |
| P-02 | Producción equivalente por elemento | ✅ VERIFICADO estructura (3 columnas, 3 avances distintos) — valores absolutos NO VERIFICADO (contaminados) |
| P-03 | Promedio ponderado y arrastre entre períodos | **DIFERIDA** — bloqueada en la práctica por AUD-04a (necesita M2 de Fraccionadora; Granja no tiene arrastre porque nunca tiene EI/EF) |
| P-04 | Costo modificado y CAUP | ✅ VERIFICADO — identidad `(UAJ−PN)×(mod+CAUP)=costo anterior` exacta; valores absolutos NO VERIFICADO (contaminados) |
| P-05 | Doble verificación de existencia final | ✅ VERIFICADO — los dos caminos coinciden exacto entre sí (no depende de la contaminación) |
| P-06 | Conjuntos: 4 métodos | **DIFERIDA** — no ejercitado, presupuesto de esta tanda |
| P-07 | Chequeo de período cerrado (error vivo n.º 5) | 🔴 **FALLA — CONFIRMADO Y REPRODUCIDO** (AUD-2026-09-14-05) |
| P-08 | Contribución marginal / PE | ✅ VERIFICADO — contra el motor puro en F2 (sin contaminación, esa prueba no dependía de `conversionFromPrevious`) |
| P-09 | Conversor de pesos a cajones | Pendiente de F4 (frontend) |
| P-10 | Desvíos abiertos en tres | **NO VERIFICADO** — ni siquiera se confirmó la existencia de un endpoint HTTP dedicado en esta pasada |
| P-11 | Coherencia aritmética de los unitarios | ✅ VERIFICADO implícito (las identidades de §4 cierran exactas, independiente de la contaminación) |
| P-12 | Trazabilidad, transacciones, contrato de error | **PARCIAL — dos ítems VERIFICADO, tres sin verificar**: aislamiento entre empresas ✅ VERIFICADO (404 en los 3 caminos probados); trazabilidad de datos nuevos ✅ VERIFICADO (`sourceDataPointId` presente); transacción con bitácora forzando un fallo, `MissingInputError` con capacidad normal en cero, y `late_data_decisions` en los caminos nuevos → **NO VERIFICADO**. |

## 6. Qué falta declarado explícitamente

- **M2, M3, M4 del proceso Granja→Fraccionadora: no cargados.** Bloqueado en la práctica por AUD-2026-09-14-04a — cargarlos exigiría repetir el workaround en cascada, sin producir cifras verificables. Una vez arreglado 04a, es directo: el mapa de endpoints y el script de M1 ya sirven de plantilla.
- **Reparto de costos conjuntos (P-06):** no ejercitado, ni siquiera una vez.
- **P-10 (desvíos vía API):** no se confirmó si existe el endpoint.
- **P-12 parcial:** transacción con bitácora forzando un fallo real, `MissingInputError` con capacidad normal en cero, y `late_data_decisions` en los caminos nuevos de esta tanda (RAG/CAPIA/unidad de gestión/módulos de rubro) — ninguno verificado.
- Las ~8 empresas de prueba creadas en esta fase (M1, las 4 de la verificación de conversión, la de P-07, las 2 de P-12) quedan en la base compartida de desarrollo — no se limpiaron. Son datos de prueba, coherentes con las cientos de "Empresa X-a/b" que ya estaban ahí de corridas anteriores.
- **El servidor de esta sesión corre en el puerto 3001** (`http://localhost:3001`), no 3000 — el 3000 tiene un proceso de otra sesión que no se tocó. Ambos quedan corriendo en background al cierre de esta fase.
