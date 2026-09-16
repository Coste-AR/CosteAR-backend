# 0017 — El costo fijo unitario se conserva en el contrato, marcado, no se elimina

- **Fecha:** 2026-09-14
- **Estado:** Aceptada
- **Decide:** Giuliana (sesión de Claude)
- **Contexto de origen:** MX-02 del plan de análisis marginal v2 (`CosteAR-admin`)

## Contexto

`costoPorCajon.fijo` divide el total de componentes clasificados `FIJO` por las unidades
producidas del período. `AM4` (bóveda, *"La falacia del costo fijo unitario"*) lo describe así:
*"el llamado 'costo fijo unitario' es una entidad inexistente en la realidad, por la sencilla
razón de que establece una comparación entre dos magnitudes absolutamente independientes entre
sí. No existe una relación causal entre ambas."* La regla dura **R10** del corpus es explícita:
los costos fijos se controlan **exclusivamente en sus manifestaciones totales**; los variables,
en valores unitarios.

`costoPorCajon.fijo` es justo lo que R10 prohíbe, y está en producción, visible en el tablero del
dueño.

## Decisión

**Se conserva en el contrato, con el mismo cálculo de siempre, pero marcado `esUnitarioDeFijo:
true`** y con una advertencia en `motivos` que explica por qué no es una magnitud económica. Al
lado se agregan los dos indicadores que sí lo son:

- **`costosFijosDelPeriodo`** — el total de componentes `FIJO`, sin dividir. La magnitud que R10
  exige.
- **`cajonesQueTapanLosFijos`** — `costosFijosDelPeriodo ÷ contribucionMarginalPorCajon`. Es la
  pregunta real que alguien hace cuando mira "cuánto fijo hay por cajón": no cuánto fijo carga
  cada unidad (no existe esa relación causal), sino cuántas unidades hay que vender para cubrir
  el fijo total. Mismo principio que MX-01 (`CM = CF`, no `V = CF`): con contribución marginal
  ≤ 0 ningún volumen alcanza, y el indicador sale incompleto con motivo — nunca un infinito.

## Alternativas consideradas

| Alternativa | Por qué no |
| --- | --- |
| Eliminar `costoPorCajon.fijo` del contrato | Rompe a cualquier consumidor existente (frontend, integraciones) sin aviso. Un contrato público no se angosta así. |
| Solo agregar los dos indicadores nuevos, dejar `fijo` como está | El número inválido sigue destacado sin ninguna señal de que lo es — no resuelve el problema real, que es la interpretación, no la existencia del campo. |
| Calcular `cajonesQueTapanLosFijos` con el precio en vez de la contribución marginal | Sería repetir exactamente el error de MX-01 en un indicador nuevo. |

## Consecuencias

**A favor**

- Ningún consumidor actual del contrato se rompe.
- Quien lea `esUnitarioDeFijo: true` (o el motivo) tiene la explicación ahí mismo, no en un ADR
  que probablemente no va a leer antes de usar el número.
- Los dos indicadores nuevos responden lo que la persona realmente estaba preguntando.

**En contra / lo que aceptamos pagar**

- El contrato de `costoPorCajon.fijo` queda con una entidad que la propia doctrina llama
  inexistente. Convive con su reemplazo en vez de irse.
- El frontend tiene que decidir qué hacer con la marca (bajar jerarquía visual, ocultar, etc.) —
  este PR solo cambia el backend; el ajuste visual queda para un PR de frontend aparte.

**Qué se rompe si alguien la revierte sin leer esto**

- Sacar la marca sin sacar el campo deja el número inválido otra vez destacado sin advertencia,
  que es exactamente el estado que esto corrige.

## Cómo se verifica que sigue vigente

`tests/http/owner-dashboard.test.ts`: `costoPorCajon.fijo.esUnitarioDeFijo` es siempre `true`
cuando el indicador existe; `costosFijosDelPeriodo` reporta el total sin dividir;
`cajonesQueTapanLosFijos` sale incompleto con contribución marginal ≤ 0, nunca un infinito.
