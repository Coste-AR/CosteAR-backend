# Eval del RAG

Mide la calidad del pipeline de la bóveda (retriever híbrido + rerank + generación) contra un
**set dorado** de casos.

## Correr

```bash
docker compose up -d postgres
npm run db:setup          # migra + RLS (la primera vez)
npm run eval:rag
```

Necesita `VOYAGE_API_KEY` (embeddings reales) y, para el juez del `criterion` y la generación,
`ANTHROPIC_API_KEY` o `GROQ_API_KEY`. Sin `VOYAGE_API_KEY` el test se saltea solo.

Deja `tests/rag/last-run.json` con las métricas de la corrida (gitignored).

## Métricas

| Métrica | Qué mide | Objetivo |
|---|---|---|
| `recallAt5` | archivos esperados presentes en los chunks devueltos | ↑ |
| `refusalCorrectRate` | casos trampa en los que el RAG se negó | ↑ (1.0) |
| `sourceHallucinationRate` | citas a archivos que no estaban en el contexto | **0 (invariante duro)** |
| `exactCitationRate` | casos respondidos cuyas citas están todas entre las esperadas | ↑ |
| `criterionPassRate` | respuestas que cumplen el `criterion` (juez Claude) | ↑ |
| `errored` | casos que fallaron por infra/API — no cuentan como regresión | — |

## El gate de CI

`.github/workflows/eval-rag.yml` corre esto en cada PR a `dev` que toca el subsistema RAG. El
test (`eval.test.ts`) compara contra `baseline.json` y **falla si una métrica cae** más de la
tolerancia (0.05). `sourceHallucinationRate != 0` siempre falla.

## Actualizar la baseline (a propósito)

```bash
UPDATE_EVAL_BASELINE=1 npm run eval:rag
git add tests/rag/baseline.json   # en el mismo PR que el cambio que la mueve
```

`baseline.json` arranca con `null` en todas las métricas: la primera corrida real con keys sin
rate limit la completa.

## El set dorado

`golden/starter.json` es un **starter** de 11 casos sobre `fixtures/eval-corpus/` (5 notas de
metodología sintéticas — sin datos de cliente). Ampliarlo con:

- la auditoría de contenido de la cátedra (issue #290 / F1-03)
- los `RAG_MISS` históricos de `daily_signals` (preguntas reales que el RAG no supo responder)
