# Bitácora — issue #301: vault-query y advisor generan con Claude

## Qué se hizo

- **`vault-query-service.ts`** y **`advisor-service.ts`** dejan de usar `GroqService` directo.
  Ahora usan `getLLMService('vault_query')` / `getLLMService('advisor')` (Claude por default —
  ver F1-09), con resolución **perezosa** (`getLLMService` evalúa `getEnv()`; el servicio se
  instancia en contextos sin el entorno completo).
- La llamada de generación va con `{ cacheSystem: true, schema }`: el system prompt
  anti-alucinación se cachea y se reusa entre requests; el schema Zod estructura la respuesta.
- **`LLMService` suma `readonly modelId: string`** — se registra en `vault_query_log.llmModel`
  (antes era `'groq'` fijo). `AnthropicLLMService` lo recibe por constructor; `GroqLLMService` →
  `'groq'`.
- El contrato `VaultQueryResult` **no cambia**. La garantía de cero alucinaciones
  (`verifiedCitations` filtra las citas contra los `sourceFile` recuperados) sigue intacta. El
  registro de `RAG_MISS` en `daily_signals` tampoco cambia.

## Decisiones

- **Sin `ANTHROPIC_API_KEY` válida, `getLLMService` cae a Groq** (comportamiento de F1-09). El
  `modelId` en el log queda `'groq'`, así el gráfico histórico distingue las corridas.
- **`schema` en `GroqLLMService`**: valida la respuesta contra el schema y devuelve `null` si no
  cumple. Groq no puede *forzar* structured output, pero al menos no propaga basura.
- La firma pública de los servicios se mantuvo compatible: el 2º parámetro pasó de
  `GroqService` a `LLMService?` (opcional). Los callers reales (`vault.routes`, `advisor.routes`,
  `costista-chat`) no pasan argumento → usan el default perezoso.

## Fuera de alcance

Medir p95 de latencia / costo reales — necesita `ANTHROPIC_API_KEY`. El clasificador (Layer 5)
sigue en Groq. Batch API.

## Verificación

```
npm run typecheck · eslint                       # verde
npx vitest run tests/application/vault-query-service.test.ts tests/application/advisor-service.test.ts tests/infrastructure/llm-service.test.ts   # 25 verdes
npx vitest run --config vitest.integration.config.ts tests/integration/vault-query-log.test.ts   # 3 verdes (rol costear_app)
npx vitest run --exclude 'tests/http/**'         # 1523 verdes, 1 skip
```

Nota: la suite completa en paralelo mostró 2-3 rojos por saturación de la máquina
(`empresa-connection-whatsapp`, `cost-structure-4xx`, `admin-stats` — nada relacionado con este
cambio); todos pasan aislados. Mismo patrón ya visto esta semana.
