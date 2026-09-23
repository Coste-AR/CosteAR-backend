# 0026 — Las evaluaciones no evaluables quedan en la bandeja

- **Fecha:** 2026-09-23
- **Estado:** Propuesta
- **Decide:** Codex, para revisión de Santiago
- **Contexto de origen:** issue #414; reemplaza parcialmente ADR-0025

## Contexto

ADR-0025 hizo observable `NO_EVALUABLE` sólo en la respuesta inmediata del
endpoint y decidió no crear una `Alert`. La pantalla de alertas consume la
bandeja después de esa llamada: si faltaba una lectura, el motivo desaparecía
y una lista vacía era indistinguible de «todo está normal». Además, las alertas
persistidas no conservaban severidad, etiqueta visible ni unidades.

## Decisión

Una evaluación `NO_EVALUABLE` crea una fila en `alerts` con el motivo y un
snapshot de la regla: severidad, clave, etiqueta visible, unidad del valor y
unidad del umbral. Una alerta fuera de umbral conserva los mismos metadatos.
Los campos son opcionales para mantener compatibles las alertas históricas y
los otros tipos de alerta.

El catálogo configurable se publica desde `PaqueteRubro.alertRules`. Cada
entrada declara clave técnica, etiqueta visible y unidad; el frontend no
conoce claves por rubro ni las transforma. Esto aplica Constitución §2
(ausencia declarada), §3 (unidad junto al valor), §4 (el paquete decide) y §5
(camino negativo probado primero).

## Alternativas consideradas

| Alternativa | Por qué no |
| --- | --- |
| Crear otra tabla de evaluaciones | Duplica la bandeja y obliga al consumidor a combinar dos contratos. |
| Mantener el motivo sólo en la respuesta de evaluación | Se pierde al recargar y vuelve a presentar ausencia como normalidad. |
| Derivar etiqueta y unidad al leer | Un cambio posterior del paquete reescribiría el significado visible de una alerta histórica. |
| Convertir snake_case en el frontend | Hardcodea conocimiento del rubro fuera de `PaqueteRubro`. |

## Consecuencias

La bandeja contiene tanto condiciones fuera de umbral como reglas que no se
pudieron evaluar, diferenciadas por `motivoNoEvaluada`. Las filas anteriores
siguen siendo válidas con metadatos nulos. La migración sólo agrega columnas y
no reescribe datos existentes.

## Verificación

Tests HTTP contrastan el JSON de `/alerts`, la persistencia del camino
`NO_EVALUABLE` y el catálogo sin etiquetas iguales a claves. La suite de
integración verifica la fila y el aislamiento con RLS real; OpenAPI publica
los dos contratos nuevos.
