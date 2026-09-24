# 0025 — Las alertas distinguen ausencia de normalidad

- **Fecha:** 2026-09-19
- **Estado:** Superada parcialmente por [ADR-0026](./0026-evaluaciones-no-evaluables-en-bandeja.md)
- **Decide:** Codex, para revisión de Santiago
- **Contexto de origen:** issue #74, S-05b

## Contexto

`ReglaAlerta` y las cuatro reglas físicas ya existían en `dev`, y la variación
del punto de equilibrio ya se recalculaba entre corridas. Sin embargo, sólo
había funciones internas: no existía un contrato para configurar las reglas ni
para evaluarlas. Además, falta de lecturas y falta de referencia devolvían
`null`, la misma ausencia de hallazgo que una medición normal.

## Decisión

La evaluación pública devuelve uno de cuatro estados: `INACTIVA`,
`NO_EVALUABLE`, `NORMAL` o `ALERTA`. `NO_EVALUABLE` siempre incluye un motivo
accionable: lectura ausente, referencia ausente o historia insuficiente para la
cantidad de lecturas sostenidas. El evaluador histórico que devuelve hallazgo o
`null` se conserva como adaptador para no cambiar el flujo del punto de
equilibrio.

Las reglas se crean, listan y editan sobre el modelo existente, con umbral,
severidad, destinatarios y canal configurables. La evaluación recibe lecturas
fechadas, crea una `Alert` sólo en estado `ALERTA` y audita cada mutación en la
misma transacción. No se agrega una tabla genérica de lecturas: cada indicador
puede seguir derivándose de su fuente física sin duplicar hechos.
Cuando el canal es `EMAIL`, se envía a los destinatarios configurados o, si la
lista está vacía, al dueño de la empresa; la entrega también queda auditada.

## Alternativas consideradas

| Alternativa | Por qué no |
| --- | --- |
| Mantener `null` y explicarlo sólo en la interfaz | El backend no permitiría distinguir ausencia de normalidad. |
| Persistir una tabla genérica de lecturas | El issue no pide una migración y duplicaría hechos ya derivados, como la postura. |
| Crear una alerta cuando falta el dato | Mezcla una falla de evaluabilidad con una condición fuera de umbral. |

## Consecuencias

La interfaz puede mostrar por qué una regla no se evaluó. Los flujos de captura
pueden enviar o derivar lecturas sin cambiar el modelo de datos. Las alertas
siguen sin modificar costos y aparecen en la bandeja existente.

## Verificación

Tests de dominio para ausencia de lectura, referencia e historia; tests HTTP
para configuración, evaluación sin datos y creación de alerta.
