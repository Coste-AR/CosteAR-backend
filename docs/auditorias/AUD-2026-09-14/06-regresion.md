# F6 — Regresión dirigida — AUD-2026-09-14

## Limitación de partida

Esta sesión no tiene acceso a la nota `001.9.2` de la bóveda (mapa del código / lista de errores vivos). Se reconstruyen los que fueron nombrados explícitamente, por número, a lo largo de esta auditoría (F0-F4): son 6 de los 8. **Los errores vivos n.º 7 y n.º 8 no tienen descripción disponible en esta sesión** — quedan NO VERIFICABLE por ese motivo, no se inventa su contenido.

## Los 8 errores vivos

### Error vivo n.º 1 — Conversor de pesos a cajones divide por precio, no por contribución marginal
**Veredicto: 🔴 SIGUE**
Reproducido en vivo hoy (F4): `$1.000.000` → `0,06 cajones`, con el rótulo propio de la pantalla diciendo *"Precio usado: $18.000.000,00 por cajón..."*. Evidencia: `04-frontend.md §1`, `capturas/02-conversor-divide-por-precio.jpg`.

### Error vivo n.º 2 — Costo fijo mostrado en unitarios (R10)
**Veredicto: 🟡 NO VERIFICABLE tal cual — pero el patrón estructural sigue ahí**
No se reprodujo el síntoma original exacto (un costo fijo REAL, no cero, dividido por unidades) porque la empresa de prueba de esta tanda no tiene ningún rubro clasificado como FIJO todavía (da $0,00). Lo que SÍ se confirmó: la tarjeta "Costo fijo **por cajón**" existe y se presenta en unitarios — la estructura que permitiría el bug original sigue en pantalla. No se puede marcar SIGUE ni ARREGLADO con la evidencia de esta tanda; hace falta cargar un fijo real clasificado y volver a mirar.

### Error vivo n.º 3 — Clasificación incompleta: ¿informa el fijo como si fuera total, o sale incompleto con motivo?
**Veredicto: 🟠 CAMBIÓ DE FORMA — se abre como hallazgo nuevo**
La parte que se arregló: `costoPorCajon.variable`, la contribución marginal y el punto de equilibrio SÍ salen "Incompleto" con los motivos exactos cuando falta clasificar — correcto. La parte que persiste, con otra cara: `costoPorCajon.fijo` no dice "Incompleto", dice **"$0,00"** — un valor concreto y falso en la misma condición de datos. Referencia al hallazgo nuevo: ver `04-frontend.md §1`, "inconsistencia entre VARIABLE/FIJO/TOTAL/RESULTADO".

### Error vivo n.º 4 — Variable + Fijo vs. Total: ¿suman? ¿misma base (producidas vs. vendidas)?
**Veredicto: ⚪ NO VERIFICABLE esta tanda**
No se pudo probar la suma porque uno de los tres operandos (`variable`) es "Incompleto" (no numérico) mientras `fijo` y `total` sí muestran números — la aritmética no es comparable en este estado. Es, en sí mismo, la manifestación de la inconsistencia del error vivo n.º 3: si `variable` fuera un número real, esta prueba sería directa. Queda pendiente de una empresa con clasificación completa.

### Error vivo n.º 5 — Período cerrado usa su propia clasificación, no la del período abierto
**Veredicto: 🔴 SIGUE — confirmado y ampliado esta tanda**
Reproducido en vivo contra la API (F3, `AUD-2026-09-14-05`): reclasificar una clave a nivel empresa con el período siguiente abierto cambia retroactivamente lo que resuelve un período YA CERRADO. No se verificó la manifestación en pantalla (F4 no llegó a esa prueba) — el mecanismo de backend ya está confirmado roto, que es la causa raíz.

### Error vivo n.º 6 — Simulador: extremos (cm→0, negativo), buscar Infinity/NaN/-0
**Veredicto: ⚪ NO VERIFICABLE esta tanda**
No se abrió la pestaña del simulador por presupuesto de tiempo. Declarado en `04-frontend.md §1`.

### Error vivo n.º 7
**Veredicto: ⚪ NO VERIFICABLE — descripción no disponible en esta sesión.**

### Error vivo n.º 8
**Veredicto: ⚪ NO VERIFICABLE — descripción no disponible en esta sesión.**

## Resumen

| Veredicto | Cantidad |
|---|---|
| 🔴 SIGUE | 2 (n.º 1, n.º 5) |
| 🟠 CAMBIÓ DE FORMA (hallazgo nuevo abierto) | 1 (n.º 3) |
| 🟡 NO VERIFICABLE, con motivo específico | 2 (n.º 2, n.º 4) |
| ⚪ NO VERIFICABLE por presupuesto/datos faltantes | 3 (n.º 6, n.º 7, n.º 8) |
| ✅ ARREGLADO | 0 |

**Ninguno de los 8 errores vivos conocidos se cerró en esta tanda.** Dos se confirman activos con evidencia nueva y reproducible (n.º 1 y n.º 5), uno cambió de forma y abre un hallazgo relacionado pero distinto (n.º 3).
