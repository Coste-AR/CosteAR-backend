# Dictamen de auditoría — AUD-2026-09-14

## 1. Alcance
- **Repos y ramas:** backend `origin/staging @ a0234dc` (rama de trabajo `auditoria/AUD-2026-09-14`) · frontend `origin/staging @ b0e7b5f` (misma rama)
- **Base de comparación:** backend `07415de`, frontend `bf70d3d` (última auditoría según F0)
- **Issues/PR dentro del alcance:** 39 del backend (26 feat/fix/test/chore + 4 promociones + resto ci/docs) y 34 del frontend (25 feat/fix/test/chore + 4 promociones + resto ci) — listados completos en `00-reconocimiento.md`
- **Qué quedó fuera y por qué:**
  - M2, M3, M4 del proceso Granja→Fraccionadora: bloqueados en la práctica por AUD-2026-09-14-04a (la contaminación se acumularía período sobre período sin producir cifras verificables)
  - P-03 (arrastre entre períodos): no verificado — depende de M2
  - P-06 (conjuntos, 4 métodos): no ejercitado, presupuesto de esta tanda
  - P-10 (desvíos vía API): no se confirmó si existe endpoint dedicado
  - El resto de P-12 (transacción forzando fallo, `MissingInputError` con capacidad normal en cero, `late_data_decisions` en caminos nuevos): no verificado
  - R1–R35: solo 13 de 35 se pudieron evaluar — falta el texto del catálogo completo en esta sesión, incluidas R8 y R11 que el pedido señaló como prioritarias
  - Simulador, PE-vs-techo forzado, sidebar por procesos, panel CAPIA, período cerrado en pantalla: no se llegó por presupuesto de tiempo en F4
  - Errores vivos n.º 7 y n.º 8: sin descripción disponible en esta sesión
- **Entorno de prueba:** local, con base sembrada — backend `localhost:3000`, frontend `localhost:5173`, Postgres real `localhost:5433`, registro real por API/browser, nada insertado a mano en la base

## 2. Opinión

**ADVERSA — no se promueve hasta cerrar los CRÍTICOS.**

Esta tanda no es un caso de "algunos hallazgos menores en una rama por lo demás sana". Se confirmaron, con reproducción en vivo y no por lectura de código, **dos defectos que impiden el uso real del producto en su único vertical de foco**: la conversión de unidades que define el rubro avícola (huevo↔maple↔cajón) no se puede cargar sin romper el cálculo (AUD-04a), y un período cerrado no está protegido de reclasificaciones posteriores — cualquier ajuste a un parámetro de costeo después de cerrar un mes le cambia el pasado a ese mes sin aviso (AUD-05, P-07). Sobre esa base rota se construye además: el conversor de pesos a cajones sigue dividiendo por precio en vez de por contribución marginal (error vivo n.º 1, confirmado hoy) y el tablero muestra un "costo fijo por cajón" y un "resultado del período" con números confiados mientras la clasificación de la que dependen está admitidamente incompleta.

Ninguno de estos cuatro hallazgos es de precisión decimal. Los cuatro son de **qué le llega a la pantalla de un cliente real que factura en este rubro**.

## 3. Marcador de reglas duras

Ver limitación completa en `05-reglas.md`. Resumen: de las 35 reglas, esta sesión solo pudo evaluar 13 con evidencia real (falta el texto de las 22 restantes, incluidas R8 y R11).

| | ✅ | 🟡 | ❌ | ⚠️ | NO VERIFICABLE |
|---|---:|---:|---:|---:|---:|
| Anterior (07-09-2026, sobre 35) | 1 | 3 | 26 | 5 | 0 |
| Esta auditoría (sobre 13 con texto conocido) | 0 | 5 | 7 | 1 | 22 |
| **Delta** | **no calculable** | — | — | — | — |

**No se puede afirmar un delta honesto sobre las 35.** Lo único comparable: R10 tiene evidencia nueva y más concreta de estar violada que la que probablemente sostenía su ⚠️ del 07-09 (la tarjeta "fijo por cajón" del tablero, ver F4) — sin el texto original del marcador anterior no se puede confirmar si es la misma evidencia o una nueva.

## 4. Hallazgos

### 🔴 CRÍTICOS (2)

#### AUD-2026-09-14-04a · La conversión entre unidades se modela como factor decimal, y las unidades del rubro huevo no son representables
**Magnitud:** bloquea el cierre de período del 100% de las avícolas de postura — el vertical de foco exclusivo y el del cliente piloto.
**Camino de remediación:** puntual, no reescritura. Cambiar `ProcessDepartment.conversionFromPrevious` de un multiplicador decimal libre a una razón entera (numerador/denominador, o reutilizar `UnidadMedida.factor` que ya modela esto bien en otra parte del sistema) resuelve los tres eslabones de la cadena avícola sin tocar el resto del motor de Costeo por Procesos. Detalle completo: `03-backend.md §3`.

#### AUD-2026-09-14-05 · Un período cerrado resuelve su clasificación de costos contra el valor VIGENTE, no contra el que tenía cuando se cerró
**Magnitud:** cualquier reclasificación empresa-wide después de cerrar un período le cambia retroactivamente la contribución marginal y el punto de equilibrio a todo período cerrado que dependa de esa fila por cascada, sin aviso ni registro.
**Camino de remediación:** puntual en el alcance del cambio, pero toca la forma en que se cierra un período. Al cerrar, congelar la clasificación resuelta de ese momento (una fila `ParametroCosteo` con `periodId` propio, o guardarla dentro del snapshot del resultado) para que la cascada empresa-wide deje de alcanzar períodos ya cerrados. No es una reescritura del motor de clasificación — es agregar un paso de "congelar" al cierre. Detalle: `03-backend.md §5.bis`.

### 🟠 GRAVE (2)

#### AUD-2026-09-14-04b · La validación cruzada exige coincidencia exacta sobre un número que por construcción viene redondeado
Independiente de 04a. **Camino de remediación:** puntual — cambiar la tolerancia fija (`> 1e-4`) por una proporcional a la magnitud de la cantidad transferida, en `validate-inputs.ts:296`.

#### AUD-2026-09-14-06 · Inconsistencia entre "Incompleto" / "$0,00" / número confiado en el tablero del dueño, con la misma condición de datos
(Antes documentado como CAMBIÓ DE FORMA del error vivo n.º 3, ver F6.) **Camino de remediación:** puntual en la capa de presentación del tablero (`owner-dashboard-service.ts`) — hacer que `costoPorCajon.fijo` y `resultadoPeriodo` propaguen el mismo estado "incompleto" que ya calculan `variable`/`contribucionMarginal`/`puntoEquilibrio`, en vez de calcular un número cuando falta la misma clasificación.

### 🟡 OBSERVACIÓN (5)
- **AUD-2026-09-14-01** — El motor de procesos está limpio de Prisma (dominio testeable sin DB), pero cero tests ejercitan el escenario avícola encadenado real.
- **AUD-2026-09-14-02** — Harness de accuracy del clasificador gateado por `CORPUS=1`, documentado en el commit de origen, sin ADR propio.
- **AUD-2026-09-14-03** — Suite corre sin `maxWorkers` fijo, igual en CI que en local; el riesgo es que una regresión real se lea como ruido.
- **Error vivo n.º 1 confirmado SIGUE** (ficha completa arriba, cuenta también como hallazgo de F4/F6).
- **Concepto duplicado** (`UnidadMedida.factor` vs `ProcessDepartment.conversionFromPrevious`) — no es un hallazgo aparte, es la causa de diseño detrás de AUD-04a, documentado en `03-backend.md §5`.

### 🔵 RECOMENDACIÓN (1)
- Si `process-costing.ts` y sus vecinos pudieran documentarse con un ejemplo del escenario avícola encadenado (aunque sea en un test), la próxima auditoría no necesitaría rearmar el mapa de endpoints desde cero.

## 5. Regresión — los 8 errores vivos

| Error vivo | Veredicto | Evidencia |
|---|---|---|
| n.º 1 — conversor divide por precio | 🔴 SIGUE | `04-frontend.md §1`, captura `02-conversor-divide-por-precio.jpg` |
| n.º 2 — costo fijo en unitarios (R10) | 🟡 NO VERIFICABLE tal cual (estructura sigue en pantalla) | `06-regresion.md` |
| n.º 3 — clasificación incompleta en `costoPorCajon` | 🟠 CAMBIÓ DE FORMA → abre AUD-2026-09-14-06 | `06-regresion.md` |
| n.º 4 — variable+fijo=total, misma base | ⚪ NO VERIFICABLE (variable no numérico en el estado actual) | `06-regresion.md` |
| n.º 5 — período cerrado usa clasificación vigente | 🔴 SIGUE, confirmado y ampliado | `03-backend.md §5.bis`, AUD-2026-09-14-05 |
| n.º 6 — simulador, extremos | ⚪ NO VERIFICABLE (no se llegó por tiempo) | `04-frontend.md §1` |
| n.º 7 | ⚪ NO VERIFICABLE (descripción no disponible) | — |
| n.º 8 | ⚪ NO VERIFICABLE (descripción no disponible) | — |

**0 de 8 arreglados. 2 confirmados activos con evidencia nueva. 1 cambió de forma.**

## 6. Lo que se verificó y está bien

- El dominio de Costeo por Procesos (`src/domain/calculations/`) está limpio de acoplamiento a Prisma — arquitectura sana, testeable sin base.
- `contribucionMarginal`/`puntoEquilibrio` (P-08) exactos contra el fixture puro, sin ninguna contaminación.
- La identidad CAUP `(UAJ−PN)×(mod+CAUP)=costo del departamento anterior` cierra exacta contra el motor real, con cualquier input (invariante de escala).
- La existencia final por los dos caminos (por diferencia y por elemento) coincide exacta — P-05.
- CAUP nunca se calcula en el primer departamento de una cadena.
- Las pérdidas extraordinarias quedan como línea separada del costo del producto, nunca se mezclan.
- El aislamiento entre empresas funciona: tres caminos cruzados probados, los tres 404.
- Ningún 500 crudo en ~20 respuestas de error observadas en toda la sesión — siempre `{error:{code,message}}`.
- La trazabilidad (`sourceDataPointId`) está viva en los datos nuevos cargados esta tanda, en el árbol de derivación.
- `unidadGestionId` es una declaración explícita del tenant, no inferida — Foco 2 de F1, limpio.
- CAPIA (`MacroSnapshot`) es append-only con fuente y fecha propias, y no hay camino de código que lo haga entrar como costo declarado — Foco 3 de F1, limpio.
- El subsistema RAG/vault no tiene ningún import cruzado hacia el motor de costeo — Foco 1 de F1, limpio.
- Cuando la clasificación está TOTALMENTE ausente, `variable`/`contribucionMarginal`/`puntoEquilibrio` muestran "Incompleto" con motivo, no un número inventado.

## 7. Limitaciones

Declaradas sin adornos, tal como se pidió:

- **M2, M3, M4 sin cargar.** Bloqueados en la práctica por AUD-04a.
- **P-03 (arrastre entre períodos) no verificado.**
- **P-06 (conjuntos, 4 métodos) no ejercitado.**
- **P-10 (desvíos vía API) no verificado** — ni siquiera se confirmó la existencia del endpoint.
- **El resto de P-12** (transacción forzando un fallo real, `MissingInputError` con capacidad normal en cero, `late_data_decisions` en los caminos nuevos de esta tanda) no verificado.
- **Las nueve cifras absolutas de M1 contra el fixture** (modificado, CAUP, unitario, a justificar, existencia final, equivalentes) quedaron **NO VERIFICADO** por el workaround de AUD-04a — ver `03-backend.md §4`.
- **22 de las 35 reglas duras (incluidas R8 y R11)** sin texto disponible en esta sesión para evaluar.
- **Simulador, PE-vs-techo forzado, sidebar por procesos, panel CAPIA, período cerrado en pantalla:** no verificados en F4 por presupuesto de tiempo.
- **Errores vivos n.º 7 y n.º 8:** sin descripción disponible en esta sesión.
- **Aumento de unidades entre departamentos, terminadas guardadas en stock por falta de capacidad, costeo por órdenes, moneda homogénea, precio de transferencia:** declarados fuera de cobertura por el propio fixture FX-AV (§11 de `fixtures-avicola.md`).
- El servidor de esta sesión corre en `localhost:3000`/`3001` (según la fase) y `localhost:5173` — quedan corriendo en background al cierre.

## 8. Reproducibilidad

- Fixture: FX-AV, `scripts/calc_fx_av.py` (corrido con `--assert`: **OK — 24 cuadres**)
- Semilla de datos: `docs/auditorias/AUD-2026-09-14/evidencia/f3-m1-script.mjs` (M1 Granja+Fraccionadora), `f4-setup.mjs` (empresa de F4), `p07-periodo-cerrado.mjs`, `p12-aislamiento.mjs`
- Comandos de la corrida: ver `evidencia/`
