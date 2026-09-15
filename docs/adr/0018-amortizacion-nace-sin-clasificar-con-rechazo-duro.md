# 0018 — La amortización de activos nace sin clasificar, con rechazo duro contra VARIABLE

- **Fecha:** 2026-09-15
- **Estado:** Aceptada
- **Decide:** Giuliana (sesión de Claude), con Giuliana eligiendo entre las alternativas presentadas
- **Contexto de origen:** M0-01 del plan de análisis marginal v2 (`CosteAR-admin`)

## Contexto

M0-01 suma cuatro renglones del costo REAL al costeo variable: variación presupuesto, trabajos de
terceros, amortización de activos y el neto de desperdicio. El plan pide que **amortización de
activos nazca con una propuesta `FIJO, confirmado=false`**, citando dos reglas del corpus:

> 🔴 **R6.** La amortización de un bien de uso es fija si la causa es el tiempo y variable si la
> causa es la intensidad de uso. La del plantel se amortiza a 24 meses calendario: es fija.
>
> 🔴 **R8.** Ningún costo fijo puede entrar en el costo variable unitario por vía de una cuota de
> aplicación. Variabilizar un fijo corrompe el punto de equilibrio.

`AM17` la llama *"el error más caro del proyecto"*: tratarla como variable cambió la contribución
marginal un 24,9 %.

**El problema:** verificar cómo implementar esa "propuesta automática" encontró que el mecanismo
no existe para clasificaciones. Hay dos catálogos de "propuesta por default" en el repo:

- `PARAMETROS_AVICOLA` (valores numéricos, ej. `huevos_por_cajon: 360`) — SÍ tiene semilla, pero
  para parámetros de **valor**, no de **clasificación**.
- `CLASIFICACIONES_AVICOLA` (los 3 `comportamiento_*` que ya existían) — tiene un campo
  `propuesta` que SÍ puede proponer un valor sin fila en la base (`resolverComportamiento` cae a
  `def.propuesta` cuando no hay fila), pero **ninguna de las 3 claves existentes lo usa**: las tres
  tienen `propuesta: null`. El mecanismo existe en el código pero nunca se ejercitó para
  clasificaciones — sería la primera vez.

Se presentaron dos caminos a Giuliana:
1. Usar ese `propuesta: 'FIJO'` para que amortización aparezca ya propuesta (más prolijo para el
   costista, pero ejercita por primera vez un camino sin cobertura de uso real).
2. Amortización nace sin clasificar, igual que MOD y CIP hoy, y un **rechazo explícito** impide
   que alguien la marque VARIABLE.

**Eligió la 2.**

## Decisión

- `CLASIFICACIONES_AVICOLA` suma `comportamiento_amortizacion_activos` con `propuesta: null` —
  nace sin clasificar, como el resto.
- `ParametrosCosteoService.set()` **rechaza con 422** cualquier intento de guardar
  `comportamiento_amortizacion_activos` con `comportamientoVolumen: 'VARIABLE'`. El mensaje cita
  R6/R8 en castellano.
- FIJO y SEMIFIJO sí se aceptan — la regla dura es específicamente "nunca variable", no "siempre
  fijo a la fuerza": si en algún caso real la amortización tuviera un componente variable
  legítimo (no es el caso de R6, pero el guard no decide eso), SEMIFIJO queda disponible.

## Alternativas consideradas

| Alternativa | Por qué no |
| --- | --- |
| `propuesta: 'FIJO'` (auto-proponer, la opción 1) | El mecanismo existe en el código pero nunca se usó para clasificaciones — sería el primer caso real, sin tests de uso previos que confirmen que `parametrosSinConfirmar` (owner-dashboard) lo muestra bien para un componente "propuesto pero sin fila". Más prolijo, pero más riesgo para una L-task que ya toca bastante superficie. |
| No hacer nada especial (dejar que salga "sin clasificar" como cualquier otro rubro) | No cumple la regla dura: alguien podría clasificarla VARIABLE sin que nada lo impida, reintroduciendo exactamente el error de `AM17`. |

## Consecuencias

**A favor**

- Cero mecanismo nuevo: reusa el patrón exacto de MOD/CIP (nace sin clasificar) más el patrón de
  rechazo explícito que el servicio ya usa para otras validaciones (ej. estructura de otra
  empresa).
- La regla dura queda protegida con un test que la ejercita literalmente: intentar VARIABLE tira
  422 con R6/R8 en el mensaje.

**En contra / lo que aceptamos pagar**

- El costista tiene que clasificarla explícitamente (FIJO o SEMIFIJO) antes de que la
  contribución marginal quede completa — no aparece ya propuesta. Mitigado en parte por la
  exención de $0 (ver más abajo): si el período no tiene amortización, no hace falta clasificarla
  para nada.
- Si el equipo más adelante quiere la propuesta automática para acelerar el alta, es un cambio
  de una línea (`propuesta: null` → `propuesta: 'FIJO'`) — no hay que revertir nada de esto.

**Qué se rompe si alguien la revierte sin leer esto**

- Sacar el guard de `parametros-costeo-service.ts` deja la puerta abierta a reintroducir
  exactamente el bug que `AM17` documenta como el más caro del proyecto.

## Efecto colateral encontrado: los rubros en $0 no deberían exigir clasificación

Al conectar los 4 componentes nuevos a una corrida real (test de integración,
`contribucion-marginal.test.ts`), **cualquier período sin trabajos de terceros, sin amortización,
sin variación presupuesto y sin desperdicio** (el caso más común) pasaba de "completa" a
"incompleta" — los cuatro llegaban con `importeAbsorcion: 0` y sin clasificar, y la regla vigente
marca como incompleto TODO componente sin clasificar, sin mirar su valor.

Clasificar un rubro en $0 no cambia ningún número: aporta lo mismo al costo variable sea cual sea
su clasificación. Exigirlo es fricción sin beneficio. Se agregó una exención en
`calcularContribucionMarginal`: un componente con `importeAbsorcion === 0` no genera motivo de
"sin clasificar" ni de "semifijo sin tramo". La exención es general (aplica también a MP/MOD/CIP
si alguna vez llegan en $0), no específica de las 4 claves nuevas.

## Cómo se verifica que sigue vigente

- `tests/application/parametros-costeo-service.test.ts`: rechaza `comportamiento_amortizacion_activos` = VARIABLE, acepta FIJO.
- `tests/domain/comportamiento-semilla.test.ts`: las 4 claves nuevas proponen `null`.
- `tests/domain/contribucion-marginal.test.ts`: un rubro en $0 sin clasificar no genera motivo.
- `tests/application/costo-real-neto.test.ts`: sin amortización clasificada (y con valor > 0), la contribución sale incompleta citando el rubro.
