# 0024 — Declarar ausencia y conceptos en cada fórmula de equilibrio

- **Fecha:** 2026-09-16
- **Estado:** Propuesta
- **Decide:** Codex, para revisión de Santiago
- **Contexto de origen:** issue #377, M3-01, plan de análisis marginal v2 §8.2

## Contexto

El equilibrio físico existente no cubre las preguntas sobre ventas necesarias,
utilidad objetivo, mezcla de productos ni los seis despejes. Cada respuesta debe
identificar los conceptos usados y evitar divisiones imposibles. M10-01 entrega
el control de tramos en otro cambio.

## Decisión

El formulario es una función pura con entrada discriminada por fórmula y un
contexto obligatorio con los conceptos declarados por su llamador. Devuelve
valor, unidad, basadoEn y tramoValidez. Usa Decimal sin redondear intermedios.
Un denominador no positivo, una entrada no finita o una mezcla cuya participación
no suma uno devuelve null con motivoSinEquilibrio.

El resultado del nivel actual conserva las pérdidas, incluso con contribución
negativa: calcular el resultado no afirma que exista un equilibrio. La marcación
se expresa en tanto por uno sobre costo variable; no equivale a margen sobre
ventas. Las participaciones también son tantos por uno y no se normalizan.

tramoValidez es null hasta M10-01: no se inventa un intervalo operativo infinito.
El equilibrio existente conserva su cálculo y redondeo con Money, y agrega
trazabilidad; sus metadatos son opcionales en el tipo para leer fotos anteriores.
Constitución §2 (ausencia), §3 (unidad) y §5 (rojo antes que verde).

## Alternativas consideradas

| Alternativa | Por qué no |
| --- | --- |
| Un objeto con todos los parámetros opcionales | Permite invocar una fórmula sin sus datos necesarios. |
| Normalizar automáticamente la mezcla | Cambia las participaciones declaradas y puede ocultar datos faltantes. |
| Reemplazar la matemática histórica por el formulario | Cambiaría el redondeo de fotos existentes sin ser necesario para M3-01. |
| Cargar tramos o publicar endpoints nuevos | Son trabajo de M10-01 o de producto; #377 pide funciones puras sin base. |

## Consecuencias

Cada consumidor selecciona una fórmula y declara sus conceptos. El contrato de
tramos tendrá que ampliarse con M10-01. Las fórmulas nuevas no se conectan a una
pantalla ni crean un contrato HTTP de planeamiento.

## Verificación

`npx vitest run tests/domain/familia-punto-equilibrio.test.ts tests/domain/punto-equilibrio.test.ts tests/domain/contribucion-marginal.test.ts`

AM-01 mantiene 750 unidades, 375.000 pesos y stock final 42.800; AM-01b mantiene
512.000 pesos con marcación 0,60. Los casos negativos declaran el motivo.
