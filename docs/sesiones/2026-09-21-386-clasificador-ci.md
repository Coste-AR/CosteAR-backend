---
issue: 386
repo: CosteAR-backend
pr: 399
rama: feat/386-clasificador-ci
agente: codex
modelo: gpt-5
tanda: B3
inicio: 2026-09-21T08:02:26-03:00
fin: 2026-09-21T08:18:40-03:00
minutos: 17
tokens: no-informado
clears: 0
intentos_hasta_verde: 2
rojos_deliberados: 2
rebotes_de_guarda: 1
---

# 2026-09-21 — El corpus del clasificador deja de depender de una corrida manual

## Qué se hizo

- Se documentó en un solo recorrido la carga, las capas 0–5, el contexto del tenant, la
  respuesta y la persistencia del resultado.
- Layer 5 acepta Groq o DeepSeek mediante tres variables de entorno y mantiene una única forma
  de respuesta validada. Groq conserva compatibilidad con la credencial existente.
- Los 18 casos de `corpus-clasificador/corpus.json` corren dentro de `npm test`, con un nombre de
  test por ID y sección esperada. La respuesta de IA se simula para que CI no dependa de cuota,
  red ni secretos.

## Decisiones que tomé sobre la marcha

- **Qué decidí:** usar DeepSeek Flash como segundo proveedor y dejar Groq como default compatible.
  **Qué otra opción había:** Moonshot/Kimi, sugerido como ejemplo por el issue, o reemplazar Groq
  como default. **Por qué elegí esta:** la documentación oficial vigente declara compatibilidad
  OpenAI, JSON output y precios públicos; cambiar el default habría exigido una credencial nueva en
  producción. Constitución §9 y §10: la elección queda escrita y no agrega un servicio pago
  obligatorio.
- **Qué decidí:** el default vigente de Groq para Layer 5 es `openai/gpt-oss-120b`.
  **Qué otra opción había:** conservar `llama-3.3-70b-versatile`. **Por qué elegí esta:** Groq
  retiró ese modelo el 16-08-2026 y recomienda GPT-OSS 120B como reemplazo de la misma clase.
- **Qué decidí:** separar la compuerta determinista de CI del harness vivo existente.
  **Qué otra opción había:** activar `CORPUS=1` en CI y llamar a un proveedor real. **Por qué elegí
  esta:** una cuota o una red caída no deben volver rojo el código; el harness vivo queda disponible
  para comparar calidad entre proveedores.

## Dónde el issue no alcanzaba

- No definía qué proveedor barato elegir ni si el default debía cambiar. Se preservó Groq para no
  romper el ambiente desplegado y se agregó DeepSeek como alternativa explícita.
- No aclaraba cómo llevar a CI los casos que necesitan Layer 5 sin una API key. Se congelaron sólo
  esas respuestas de IA en el test; todas las capas y la decisión final siguen siendo código real.
- No mencionaba que el modelo Groq fijado por Layer 5 ya estaba retirado; se corrigió dentro del
  alcance de hacer configurable ese fallback.

## Qué quedó afuera

- Las reglas de las capas 0–4, RAG y costo por carga no cambian.
- OCR/extracción de archivos sigue en `GroqService`; la configuración nueva es sólo para Layer 5.
- No se comparó calidad real entre modelos porque requeriría credenciales/cuota. El harness vivo
  permanece disponible con `CORPUS=1`.

## Con qué se verifica

```bash
npm run lint
# verde
npm run typecheck
# verde
npm run test -- --maxWorkers=1
# 213 archivos; 1.857 tests verdes; 4 skipped existentes
npx vitest run tests/config/env.test.ts tests/classifier/corpus-ci.test.ts tests/classifier/classifier-ai-provider.test.ts tests/ai/groq-validation.test.ts
# 4 archivos; 56 tests verdes
npm run check:tests-base
# verde
npm run check:openapi
# verde; 23 operaciones sin cambios
npm run typecheck:openapi-consumer
# verde
npm run build
# verde
```

Rojos deliberados: antes de implementar, la suite focalizada falló por cliente/variables
inexistentes; después se cambió temporalmente `MP-01` de `MATERIA_PRIMA` a
`COSTOS_INDIRECTOS` y `corpus-ci.test.ts` falló nombrando exactamente
`MP-01 → COSTOS_INDIRECTOS`. Restaurado el corpus, los 18 casos pasaron. La primera suite general
tuvo el timeout conocido de `owner-dashboard` y una incompatibilidad del mock mínimo de entorno;
el test HTTP pasó aislado 12/12 y la segunda suite completa quedó verde. El pre-commit rebotó una
vez por tipos demasiado estrechos del transporte; se corrigieron sin saltear la guarda.
