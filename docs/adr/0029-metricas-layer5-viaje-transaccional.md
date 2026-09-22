# ADR 0029 — Las métricas de Layer 5 viajan con el resultado y se guardan con la carga

## Estado

Aceptado — 2026-09-21, issue #390.

## Contexto

Layer 5 llama a un proveedor OpenAI-compatible antes de que exista la fila de
`DataEntry`. El proveedor puede responder una vez, exigir un segundo intento por
JSON inválido, omitir `usage` o fallar. Había que medir cada request sin guardar
el prompt ni separar la métrica de la carga que la originó.

## Decisión

- El cliente emite una métrica por request HTTP: proveedor, modelo, tokens de
  entrada/salida nullable, latencia y costo estimado nullable.
- La tabla de precios vive en `CLASSIFIER_AI_PRICING_JSON`, por proveedor y
  modelo, expresada por millón de tokens y con moneda obligatoria. La moneda se
  persiste junto al costo; nunca se mezclan importes de monedas distintas.
- La cascada transporta esas métricas como metadatos, sin contenido del
  documento. `ingestDataEntry` las inserta después de crear la `DataEntry`,
  dentro de la misma transacción que la entrada y su `ClassificationAudit`.
- Una respuesta sin `usage` o fallida queda como llamada sin medir (`tokens =
  null`, `estimatedCost = null`), no como cero. Una clasificación resuelta antes
  de Layer 5 no produce métricas.
- El resumen admin recorre los tenants bajo su contexto RLS y agrupa por
  proveedor y moneda. No abre una excepción cross-tenant en la política.

## Alternativas descartadas

- **Guardar desde el cliente HTTP:** en ese momento todavía no existe el id de
  la carga y una caída posterior dejaría una métrica huérfana.
- **Usar logs:** no permite consulta reproducible ni vínculo con la carga.
- **Guardar cero cuando falta `usage`:** confunde ausencia de medición con uso
  gratuito y falsea el precio del producto.
- **Fijar precios o USD en código:** los proveedores cambian precios y la unidad
  debe viajar con el valor (Constitución §3).

## Consecuencias

Cada retry cuenta como una llamada facturable independiente. Si no se configura
precio para el par proveedor/modelo, se conservan tokens y latencia pero el costo
queda ausente. El endpoint admin puede ser más costoso al recorrer tenants; es un
reporte interno acotado por fechas, no una ruta caliente.
