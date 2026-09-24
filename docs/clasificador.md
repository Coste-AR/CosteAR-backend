# Clasificador de documentos

## Recorrido real

1. **Entrada.** `registerEmpresaPortalRoutes` recibe `POST /empresa-portal/submit` en
   `src/infrastructure/http/routes/empresa-portal.routes.ts` y llama a
   `EmpresaPortalService.submitDocument`. Los canales `POST /datos/submit`, WhatsApp y Telegram
   convergen en el mismo flujo.
2. **Ingesta única.** `ingestDataEntry`, en
   `src/application/ingest/ingest-data-entry.ts`, resuelve empresa, rubro y escala. Para archivos
   llama primero a `GroqService.analyzeDocument`: ese paso extrae texto/calidad/OCR y no es la
   Layer 5 configurable de este documento.
3. **Disparo.** `ingestDataEntry` arma `textToClassify`, deduplica por CAE o proveedor+número y
   llama a `classifyDocument` de
   `src/infrastructure/classifier/cascade-classifier.ts` con el texto enriquecido, el rubro del
   tenant, la escala y los datos extraídos.
4. **Capas 0–4.** `classifyDocument` aplica quality gate, intención, señales definitivas,
   corroboración, validación numérica y ruteo de negocio. Si todas coinciden y superan el umbral,
   devuelve sin usar IA.
5. **Contexto de Layer 5.** Si quedan conflicto, ambigüedad o pocos puntos,
   `runLayer5` (`src/infrastructure/classifier/layers/layer5-ai-fallback.ts`) recibe señales,
   puntaje, tipo sugerido, rubro/categoría del tenant, intención, pista de ambigüedad y ejemplos de
   correcciones anteriores. `GroqClassifier.classifyDocument`, en
   `src/infrastructure/ai/groq-classifier.ts`, convierte ese contexto en los mensajes y el JSON
   pedido al modelo.
6. **Proveedor y respuesta.** `createClassifierAiClient`, en
   `src/infrastructure/classifier/classifier-ai-client.ts`, envía el mismo contrato OpenAI
   Chat Completions a Groq o DeepSeek. La respuesta se valida con
   `classifyResponseSchema`; un JSON inválido se reintenta con una pista precisa y luego se
   degrada a `DESCONOCIDO` para revisión. Una API caída devuelve ausencia de IA, no una categoría
   inventada.
7. **Decisión y persistencia.** `resolveSectionAfterAI` vuelve a cruzar la sección de IA con las
   reglas de Layer 4. `buildSectionAndExplanation` produce juntos valor y explicación.
   `ingestDataEntry` guarda `DataEntry` y `ClassificationAudit` en la misma transacción y devuelve
   clasificación/estado al canal que originó la carga.

## Configuración de Layer 5

| Variable | Valores / ejemplo | Comportamiento |
| --- | --- | --- |
| `CLASSIFIER_AI_PROVIDER` | `groq` (default) o `deepseek` | Un valor distinto impide arrancar mediante la validación de `parseEnv`. |
| `CLASSIFIER_AI_MODEL` | `openai/gpt-oss-120b` o `deepseek-flash` | Si falta, se elige el modelo vigente por proveedor. |
| `CLASSIFIER_AI_API_KEY` | secreto, sin default | Para Groq puede omitirse y reutiliza `GROQ_API_KEY`; DeepSeek queda deshabilitado si falta. |

Groq usa `https://api.groq.com/openai/v1/chat/completions`; DeepSeek usa
`https://api.deepseek.com/chat/completions`. No hay claves ni valores que parezcan credenciales
reales en el repositorio. DeepSeek Flash se agregó como segunda opción porque ofrece contrato
OpenAI-compatible, salida JSON y, al 21-09-2026, cobra USD 0,15/0,60 por millón de tokens de
entrada/salida fuera de hora pico (USD 0,30/1,20 en pico). Fuentes oficiales:
[inicio rápido](https://api-docs.deepseek.com/) y
[modelos y precios](https://api-docs.deepseek.com/quick_start/pricing/).

## Verificación

- `tests/classifier/corpus-ci.test.ts` corre con `npm test`, por lo tanto dentro de
  `build-and-test`. Publica un test por ID y sección esperada del corpus. Layer 5 se simula para
  que el resultado dependa del código y del corpus, no de una cuota externa; cambiar la sección
  esperada de un caso rompe ese caso por nombre.
- `tests/classifier/corpus-avicola.harness.test.ts` conserva la medición en vivo y opt-in con
  `CORPUS=1`; sirve para comparar proveedores/modelos, no como compuerta de CI.
- `tests/classifier/classifier-ai-provider.test.ts` verifica que DeepSeek usa su endpoint y modelo,
  omite el `seed` no soportado y devuelve la misma forma validada que Groq.
