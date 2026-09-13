# 0013 — Harness de evals del RAG propio, no Promptfoo

- **Fecha:** 2026-09-11
- **Estado:** Aceptada
- **Decide:** Giuliana (sesión de Claude), retroactivo — la decisión se tomó al implementar F1-12
- **Contexto de origen:** issue F1-12 (`tests/rag/eval-runner.ts`, PR #327), auditoría de decisiones
  del 11-09-2026

## Contexto

El spec del rediseño del RAG (`docs/superpowers/specs/2026-09-09-rediseno-rag-design.md`, §5.7)
proponía **Promptfoo** como runner declarativo de evals, con métricas estilo RAGAS calculadas por
un juez Claude, corriendo contra una DB de test sembrada. `docs/superpowers/specs/2026-09-09-herramientas-a-evaluar.md`
lo marca 🟡 ("evaluar, no adoptar directo") — no era una recomendación firme del todo, a diferencia
de otras herramientas del mismo documento marcadas 🟢.

Al implementar F1-12 se construyó en cambio un harness propio (`tests/rag/eval-runner.ts`) que
corre dentro de la suite de Vitest existente (`vitest.eval.config.ts`, `npm run eval:rag`), en vez
de sumar Promptfoo como dependencia y runner separado.

## Decisión

**Queda el harness propio.** No se migra a Promptfoo mientras el propio harness cumpla el
contrato que el spec pedía: `recallAt5`, `refusalCorrectRate`, `sourceHallucinationRate` (0 es
invariante duro), `exactCitationRate`, `criterionPassRate` vía juez Claude, comparación contra
`tests/rag/baseline.json` con tolerancia, y gate en CI (`.github/workflows/eval-rag.yml`).

## Alternativas consideradas

| Alternativa | Por qué no |
| --- | --- |
| Promptfoo (la opción del spec original) | Suma una dependencia y un runner nuevo para un caso de 11 casos dorados. El dashboard visual que ofrece no compensa, hoy, el costo de mantener dos sistemas de test en paralelo (Vitest + Promptfoo) con su propia config, su propio modo de correr en CI y su propia curva de aprendizaje para el equipo. |
| RAGAS como librería (sin Promptfoo) | Evaluado indirectamente: las métricas que RAGAS mide (faithfulness, context recall/precision) se cubren con las métricas propias (`sourceHallucinationRate`, `exactCitationRate`, `criterionPassRate`) sin sumar una dependencia de Python en un backend Node/TS. |

## Consecuencias

**A favor**

- Una sola herramienta de test en el repo (Vitest) para todo: unitarios, integración, e2e y evals.
- El harness vive en TypeScript, mismo lenguaje que el resto del backend — cualquiera que ya sabe
  leer los tests del repo puede leer `eval-runner.ts` sin aprender la sintaxis de Promptfoo.
- Se integra gratis con `tests/db-dependent.mjs`, `check:tests-base` y el resto de la
  infraestructura de CI que ya existe.

**En contra / lo que aceptamos pagar**

- Sin el dashboard de Promptfoo: los resultados de una corrida quedan en
  `tests/rag/last-run.json` (gitignored) y en el log de CI, no en una UI navegable.
- El set dorado sigue chico (11 casos). Promptfoo tiene mejor soporte para sets grandes con
  comparación lado a lado entre corridas — si el set dorado crece a los 60-100 casos que el spec
  original imaginaba (F1-03 + `RAG_MISS` históricos), conviene revisar esta decisión.
- Reinventamos el cálculo de métricas en vez de apoyarnos en una librería madura — más superficie
  propia para mantener, aunque hoy es un archivo chico y con tests.

**Qué se rompe si alguien la revierte sin leer esto**

- Migrar a Promptfoo sin más contexto duplicaría el trabajo: haría falta reescribir el cálculo de
  las 5 métricas actuales dentro de la config de Promptfoo, y decidir de nuevo cómo se compara
  contra `baseline.json` y cómo se integra con `check:tests-base`.

## Cómo se verifica que sigue vigente

`npm run eval:rag` sigue reportando las 5 métricas del spec y comparando contra
`tests/rag/baseline.json`. Si el set dorado supera ~30-40 casos o el equipo necesita comparar
corridas históricas lado a lado, reabrir esta ADR y reevaluar Promptfoo con datos reales de uso.
