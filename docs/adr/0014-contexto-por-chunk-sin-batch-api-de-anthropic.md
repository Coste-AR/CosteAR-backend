# 0014 — Contexto por chunk con llamadas agrupadas, no con la Batch API de Anthropic

- **Fecha:** 2026-09-11
- **Estado:** Aceptada (revisar cuando el volumen crezca — ver "Cómo se verifica")
- **Decide:** Giuliana (sesión de Claude), retroactivo — la decisión se tomó al implementar F1-05
- **Contexto de origen:** issue F1-05 (`vault-indexer-service.ts`, `contextual-prefix.ts`),
  auditoría de decisiones del 11-09-2026

## Contexto

El spec del rediseño del RAG (§5.2) proponía generar el `contextualPrefix` de cada chunk con
**prompt caching** (el documento completo se cachea, cada chunk varía) **+ Batch API de Anthropic**
(–50% de costo, procesamiento asíncrono), para que reindexar cientos de chunks se mantuviera en
"centavos".

`vault-indexer-service.ts` implementa el prompt caching (confirmado: `cacheSystem: true` en
`completeJSON`), pero **no** usa la Batch API real. En su lugar agrupa el trabajo con
`BATCH_SIZE = 5` y dispara llamadas normales en paralelo (`Promise.all`) de a 5 por vez — "batch"
en el sentido de "lote de concurrencia", no en el sentido del endpoint asíncrono de Anthropic que
da el descuento del 50%.

## Decisión

**Queda como está por ahora.** Con 92 notas indexadas (F1-02, opción B) el costo real de un
reindex completo es de centavos de dólar incluso sin el descuento — la diferencia no es
perceptible al tamaño actual de la bóveda. No se justifica la complejidad extra de la Batch API
(someter el lote, hacer polling del resultado, manejar el caso de que el job tarde horas) para un
ahorro que hoy no se nota.

## Alternativas consideradas

| Alternativa | Por qué no (ahora) |
| --- | --- |
| Batch API de Anthropic (la opción del spec original) | Descuento real del 50%, pero el flujo es asíncrono (se somete el lote y se consulta después, puede tardar hasta 24hs) — reescribir `vault-indexer-service.ts` para tolerar esa latencia es trabajo real que hoy no se paga solo con 92 notas. |
| Subir `BATCH_SIZE` para más paralelismo | No ataca el costo (que es por token, no por cuánto paraleliza), solo la velocidad del reindex. Se puede hacer en cualquier momento sin relación con esta decisión. |

## Consecuencias

**A favor**

- `vault-indexer-service.ts` se mantiene simple: llamadas síncronas normales, mismo patrón que el
  resto del `LLMService`, sin un segundo camino asíncrono para mantener.
- El prompt caching (la otra mitad de la mitigación de costo del spec) sí está activo y sí reduce
  costo real hoy.

**En contra / lo que aceptamos pagar**

- El reindex cuesta ~2× lo que el spec original asumía, en el rubro "generación de contexto por
  chunk".
- **Este costo crece con la bóveda, no es plano.** F1-03 (auditoría de cátedra) y F1-14 (curación
  agéntica) van a sumar contenido con el tiempo — cuantas más notas, más se nota el 2× no
  descontado.

**Qué se rompe si alguien la revierte sin leer esto**

- Migrar a la Batch API sin este contexto puede hacerse creyendo que es un cambio chico de
  configuración; no lo es — cambia el modelo de ejecución del indexado de síncrono a
  someter-y-consultar, y afecta cómo se reporta `IndexVaultResult` mientras el lote está pendiente.

## Cómo se verifica que sigue vigente

Sin métrica automática todavía. Revisar esta ADR cuando:
- el reindex completo empiece a tardar más de unos minutos, o
- el costo mensual de la generación de contexto (una vez que `vault_query_log` o un log de
  indexado equivalente dé el número real) deje de ser "centavos".

Ninguno de los dos pasa hoy con 92 notas.
