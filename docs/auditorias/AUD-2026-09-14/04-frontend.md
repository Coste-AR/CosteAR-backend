# F4 — Frontend — AUD-2026-09-14

Backend real en `localhost:3000` (rama `auditoria/AUD-2026-09-14`), frontend real en `localhost:5173` (misma rama = `origin/staging` @ `b0e7b5f`). Navegado con browser real, empresa cargada por API (`docs/auditorias/AUD-2026-09-14/evidencia/f4-setup.mjs`) + `seed:tenant-avicola` para la unidad de gestión.

**Regla de esta fase, seguida:** las aserciones son estructurales (forma, fórmula, rótulo), no de pesos exactos — el input de la empresa de prueba no es el fixture FX-AV completo, es una estructura mínima propia con `unidadGestionId` seteado a mano después de correr `seed:tenant-avicola`.

## 1. Prioridad 1 — errores vivos de pantalla

### ✅ Confirmado — Error vivo n.º 1 (conversor) SIGUE
**Captura:** `capturas/02-conversor-divide-por-precio.jpg`

Cargué `$1.000.000` en el conversor. Resultado: **`0,06 cajones de huevo (360 huevos)`**, y la propia pantalla rotula la base: *"Precio usado: $18.000.000,00 por cajón de huevo (360 huevos) · Período 2026-01"*.

Test de razón (inmune a que mi input no sea el FX-AV): `1.000.000 / 18.000.000 = 0,0555... ≈ 0,06`. El propio label dice **"Precio usado"**, no "contribución marginal usada". **Es el error vivo n.º 1: SIGUE.** El rótulo tampoco dice "te cuesta N cajones de venta adicional" — dice llanamente el número, sin la frase correctiva que pide `AM17 §10.2`.

**Nota sobre el "$18.000.000 por cajón":** es un número absurdo para un precio de venta — viene de que mi estructura de prueba cargó el precio de venta ($50.000) contra una unidad genérica, no contra "huevo", y el conversor de unidad de gestión multiplicó por 360 asumiendo que la base SÍ era huevo. Es un artefacto de mi setup, no se lo puede usar como magnitud del error — pero **no cambia la conclusión sobre el mecanismo**: sea cual sea la base, la pantalla admite con su propio rótulo que divide por precio.

### ⚠️ Encontrado, no buscado — inconsistencia entre VARIABLE / FIJO / TOTAL / RESULTADO
**Captura:** `capturas/01-tablero-costo-por-cajon-inconsistente.jpg`

Con las tres rúbricas SIN clasificar (materia prima, mano de obra, costos indirectos):

| Tarjeta | Valor mostrado |
|---|---|
| Costo variable por cajón | **Incompleto** (con los 3 motivos listados) |
| Costo fijo por cajón | **$0,00** |
| Costo total por cajón | **$6.530.400,00** |
| Contribución marginal por cajón | **Incompleto** (mismos 3 motivos) |
| Punto de equilibrio | **Incompleto** (mismos 3 motivos) |
| Resultado del período | **$23.895.000,00** |

**El problema estructural:** frente a la MISMA condición (cero rubros clasificados), el sistema da tres tratamientos distintos — "Incompleto" (variable, contribución marginal, PE — correcto), "$0,00" (fijo — un valor concreto y falso: no es que no haya costos fijos, es que no se sabe cuáles lo son) y un número confiado (total, resultado — calculado igual que si todo estuviese resuelto). Un costista que mire solo la tarjeta de "Costo total" o "Resultado del período" nunca se entera de que la mitad de la clasificación falta. Es el mismo modo de falla que R13 describe para el punto de equilibrio (parcial presentado como total), pero acá aparece en TRES tarjetas más.

**No es exactamente el error vivo n.º 2** (R10, fijo mostrado como unitario cuando SÍ hay un fijo cargado) — acá el fijo da $0,00 porque nada está clasificado como fijo todavía, no porque un fijo real se esté partiendo por unidades. Queda declarado como hallazgo aparte, más amplio: la inconsistencia de "incompleto vs. confiado" entre tarjetas del mismo tablero.

### ✅ Positivo — clasificación incompleta se declara, con motivo
Las tres tarjetas que SÍ dependen de la clasificación (variable, contribución marginal, PE) muestran "Incompleto" con la lista exacta de qué rubro falta clasificar — no inventan un número. El bloque "Qué falta cargar para cerrar el período" también lista exactamente los mismos 3 pendientes + "la empresa no tiene un paquete de rubro declarado". Esto es correcto y es justo lo que R13 pide para el caso de clasificación 100% ausente.

**Lo que NO se pudo probar en esta pasada:** el caso R13 más fino — clasificación PARCIAL (algunos rubros sí, uno no) — que es el que dispara la "zona [x,y]" en vez de "Incompleto" llano. Mi estructura de prueba tiene las 3 rúbricas sin clasificar a la vez, no una mezcla. **NO VERIFICADO** si el producto muestra una zona o solo "Incompleto"/un punto cuando la clasificación es parcial.

### NO VERIFICADO por presupuesto de tiempo (declarado, no silenciado)
- **Simulador** (error vivo n.º 6, `ScenarioSimulator.tsx:90`): no se abrió la pestaña ni se forzaron los extremos (cm→0, cm negativo, buscar `Infinity`/`NaN`/`-0`).
- **PE vs. techo del tramo** (R29): no se forzó un escenario con costo fijo alto para ver si avisa "fuera de tu capacidad instalada".
- **Período cerrado en pantalla**: no se cerró el período de esta empresa de prueba ni se verificó cómo se ve el aviso de cierre (ya está confirmado roto a nivel API por AUD-2026-09-14-05 — falta ver la manifestación en pantalla).
- **Sidebar por procesos** (rediseño 13-09): no se navegó.
- **Panel CAPIA**: no se navegó; no se verificó el disclaimer de "no es tiempo real" ni el enlace.

## 2. Playwright — 11 specs del alcance

Corridos completos (`npm run test:e2e`, 4 proyectos: chromium, webkit, Mobile Chrome, Mobile Safari — Playwright levanta su propio servidor Vite, independiente de la sesión manual de arriba). Comando terminó con **exit code 0**.

**120 tests totales · 118 passed · 2 skipped · 0 failed.**

Los 11 specs del alcance (`auth`, `clasificacion-costos`, `configuracion-rubro`, `desperdicios-periodo`, `panel-campo`, `parametros-negocio`, `simulador-clasificacion`, `smoke-autenticado`, `smoke-publico`, `tablero-dueno`, `trabajos-terceros-periodo`) pasaron en los 4 proyectos, sin excepción.

Nota sobre el reporter: 3 casos de `smoke-autenticado.spec.ts:20:6` (*"el fixture autenticado falla ante una request sin respuesta definida"*) aparecen marcados `x` en la salida de `list` — por el título, es un test que verifica que el propio fixture de autenticación E2E lanza error correctamente ante una request sin mock definido (una prueba negativa a propósito, no una regresión). Cuenta dentro de los 118 passed; no se abrió como hallazgo porque el nombre del test y el resultado son coherentes entre sí — se declara la duda menor porque no se leyó el archivo fuente para confirmarlo al 100%.

**2 skipped:** `smoke-publico.spec.ts:82` ("no hay scroll horizontal en mobile") no corrió en `chromium`/`webkit` (proyectos de escritorio) — consistente con ser un test mobile-only, no una omisión.
