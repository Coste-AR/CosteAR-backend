# ADR 0029 — Los widgets se derivan de las superficies del paquete

## Estado

Aceptada — 2026-09-21.

## Contexto

#389 pide un catálogo backend de accesos rápidos con clave, etiqueta y módulo,
pero no define otra fuente de claves. Desde #384 cada módulo ya declara las
`superficies` que habilita y la configuración de la empresa decide si está
prendido o apagado. Crear una segunda lista de widgets hubiera permitido que
ambos catálogos diverjan.

El contrato tampoco recibe `companyId`. El modelo anterior a #401 todavía une
al dueño con sus empresas mediante `Company.userId`, mientras el home trabaja
con un contexto empresarial único.

## Decisión

- Cada superficie declarada por un módulo es una clave de widget. La etiqueta y
  el módulo salen de esa misma declaración.
- El catálogo público contiene sólo widgets de módulos prendidos. El `PUT`
  compara además contra el catálogo completo para distinguir una clave
  inexistente de una válida cuyo módulo está apagado.
- Los widgets de módulos `activoPorDefecto` forman el default cuando todavía no
  existe una fila de preferencias.
- Hasta #401, las rutas `/me` resuelven de forma determinista la primera empresa
  activa del usuario. No se agrega un parámetro que el contrato no pidió.

## Consecuencias

- Paquete, configuración de módulos y accesos rápidos comparten una sola fuente
  de verdad; sumar una superficie la vuelve elegible sin otro registro.
- Una cuenta legacy con varias empresas usa la primera activa para este contrato.
  #401 deberá reemplazar esa compatibilidad por el contexto del rol empresarial.
- Una preferencia guardada no se reescribe cuando se apaga un módulo. El catálogo
  deja de ofrecerlo y una escritura posterior lo rechaza; no se destruye la
  elección histórica en silencio.

## Principios aplicados

- Constitución §4: el comportamiento depende del paquete y no de un cliente.
- Constitución §9: la ambigüedad del contexto empresarial queda explícita y
  acotada, no escondida en un parámetro nuevo.
