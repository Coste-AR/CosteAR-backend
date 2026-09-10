# 0011 — Advertir cuando la escala sale de la calibración

- **Fecha:** 2026-09-08
- **Estado:** Aceptada
- **Decide:** Equipo CosteAR
- **Contexto de origen:** issue #202

## Contexto

Un perfil de rubro puede declarar la escala física con la que fue calibrado, y la empresa puede declarar su propia escala de operación. Antes de esta decisión el clasificador podía entregar una clasificación de alta confianza sin revelar que ambos contextos eran materialmente distintos. La señal no puede alterar la decisión ni sus pesos: eso queda explícitamente fuera del alcance del issue.

## Decisión

La cascada compara la escala declarada de la empresa con la escala opcional resuelta desde el paquete del perfil. Si ambas tienen la misma unidad y su cociente es tres o más, devuelve `scaleCalibrationWarning` con `OUTSIDE_CALIBRATED_RANGE` y el factor observado. Si las unidades difieren, devuelve `UNIT_MISMATCH` sin convertirlas.

La señal es aditiva e informativa: no cambia tipo de documento, sección, confianza, revisión ni pesos. Una escala ausente conserva exactamente el comportamiento previo. Por ahora se resuelve el paquete de postura para la categoría de industria avícola; las demás categorías no inventan una calibración hasta que exista su paquete.

## Alternativas consideradas

| Alternativa | Por qué no |
| --- | --- |
| Bajar la confianza o forzar revisión | Cambia la decisión de la cascada y el issue lo prohíbe expresamente. |
| Convertir unidades distintas automáticamente | No hay una taxonomía ni factores de conversión declarados; una equivalencia inventada sería un dato de negocio falso. |
| Usar un umbral menor o mayor | El issue no fijó el factor. Tres veces distingue una variación operativa razonable de un contexto que merece revisión humana sin volver la señal demasiado frecuente. |
| Declarar escalas por defecto para todos los rubros | Haría parecer calibraciones reales donde el paquete no declaró ninguna. |

## Consecuencias

**A favor**

- Quien consume la clasificación puede escalar a una persona una discrepancia de contexto sin perder la salida determinista existente.
- No se introducen conversiones ni escalas de negocio no verificadas.

**En contra / lo que aceptamos pagar**

- El consumidor debe entender la nueva señal opcional.
- Mientras no haya paquetes calibrados para más rubros, la advertencia solo estará disponible donde exista una escala declarada.

**Qué se rompe si alguien la revierte sin leer esto**

- Una clasificación puede volver a parecer igualmente confiable fuera del rango para el que se configuró el perfil, sin que el consumidor tenga forma de detectarlo.

## Cómo se verifica que sigue vigente

`tests/classifier/scale-calibration-warning.test.ts` verifica el rango, la diferencia material, las unidades incompatibles y que la decisión de alta confianza se conserva.
