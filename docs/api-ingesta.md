# API de ingesta de documentos (`POST /datos/submit`)

Superficie **pública** de la API: la usan sistemas externos del cliente para
mandar comprobantes sin pasar por el portal web. Se autentica por API key, no
por JWT.

> Este contrato lo consumen integraciones que viven fuera de estos repos y que
> no podemos desplegar nosotros. **Cambios acá son breaking changes**: agregar
> campos está bien, renombrarlos o sacarlos no.

---

## Request

```http
POST /api/v1/datos/submit
x-api-key: <la apiKey de la EmpresaConnection>
Content-Type: application/json

{
  "rawContent": "Factura A 0001-00012345 — Molinos SA — $150.000",
  "sourceType": "TEXT"
}
```

| Campo | Tipo | Req. | Notas |
|---|---|---|---|
| `rawContent` | string | sí | 1 a 10.000 caracteres |
| `sourceType` | enum | no | `TEXT` (default) · `PDF` · `IMAGE` · `WHATSAPP` |

La API key sale de `EmpresaConnection.apiKey`; el costista la genera y la rota
desde el panel. Si la conexión está inactiva, la key deja de funcionar.

---

## Respuestas

La forma del `data` es **estable en los dos casos de éxito**: `id`, `status` e
`isDuplicate` están siempre presentes. Un cliente que lee `data.id` funciona sin
ramificar; uno que quiera distinguir el duplicado mira `data.isDuplicate`, que
nunca viene `undefined`.

### `201 Created` — entrada nueva

```json
{
  "data": {
    "id": "9f8c...",
    "status": "PENDING",
    "isDuplicate": false,
    "classification": {
      "documentType": "FACTURA_COMPRA",
      "costSection": "MATERIA_PRIMA",
      "confidence": 88,
      "requiresReview": false,
      "qualityGate": "PASS"
    }
  }
}
```

`classification` es el resultado del clasificador en cascada. `requiresReview`
en `true` significa que el documento entró igual, pero espera confirmación del
costista antes de impactar en la estructura de costos.

### `200 OK` — el comprobante ya había sido enviado

```json
{
  "data": {
    "id": "3a1b...",
    "status": "APPROVED",
    "isDuplicate": true,
    "message": "Este comprobante ya fue enviado antes (mismo proveedor y número)."
  }
}
```

**No se creó nada.** `id` apunta a la entrada que ya existía y `status` es su
estado real en ese momento — puede estar `PENDING`, `APPROVED`, `REJECTED` o
`CORRECTED`. Reenviar el mismo comprobante es seguro: no duplica ni pisa nada.

La detección de duplicados usa dos criterios:

1. **CAE** — si el comprobante trae CAE y ese CAE ya fue procesado.
2. **Proveedor + número de comprobante** — clave fuerte, solo cuando los dos
   datos están presentes, para no rechazar compras legítimas repetidas. Ignora
   las entradas ya rechazadas.

### Errores

| Código | Cuándo |
|---|---|
| `400` | `rawContent` vacío o de más de 10.000 caracteres, `sourceType` inválido |
| `401` | falta el header `x-api-key` |
| `404` | la API key no existe o la conexión está inactiva |
| `409` | el documento es ilegible y no se pudo clasificar (mandar una foto más clara) |
| `429` | límite de requests excedido |

Forma del error: `{ "error": { "code": "...", "message": "..." } }`.

---

## Para quien toque este endpoint

- La respuesta viene de `ingestDataEntry()` (`src/application/ingest/`), el
  camino único de ingesta que comparten el portal, este endpoint y el webhook de
  WhatsApp. Si agregás un canal nuevo, usá esa función: crear `DataEntry` por
  fuera se saltea la clasificación, y una entrada sin `ClassificationAudit` es
  invisible para el resto del sistema.
- Los campos de `data` se pueden **agregar** libremente. Renombrar o quitar
  `id`, `status` o `isDuplicate` rompe integraciones que no controlamos.
- El test de contrato está en `tests/http/datos-submit-contract.test.ts`.
