# 2026-09-11 — Balance verificable de la tanda

- **Issue:** #337
- **Repo:** CosteAR-backend
- **Rama:** `feat/issue-337-balance-tanda`
- **PR:** pendiente de apertura
- **Agente:** Codex

## Recursos

| | |
| --- | --- |
| Tiempo de la sesión | no informado |
| Tokens consumidos | no informado |
| Intentos hasta el verde | 3: import inexistente (rojo), aserción de fixture incorrecta (rojo), suite focalizada verde |
| Comandos de verificación corridos | `npm exec -- vitest run tests/scripts/balance-tanda.test.ts`, `node scripts/balance-tanda.mjs --desde 2026-08-30 --hasta 2026-09-11`, `npm run lint`, `npm run typecheck`, `npm run test`, `npm run check:tests-base`, `npm ci`, `npm run prisma:generate` |

## Qué se hizo

Se agregó `scripts/balance-tanda.mjs`, que lee los PRs mergeados de backend,
frontend, admin y OS en un rango de fechas y genera una tabla por agente e
issue. Mide trabajo desde el primer commit hasta el merge, espera desde
`listo`, corridas/fallas de CI, tamaño, rebotes del guardián y commits luego del
primer verde. Los tokens figuran explícitamente como **ausente**.

La corrida B1 real analizó 249 PRs entre los cuatro repositorios. Encontró una
fila sin corridas de CI y terminó con código 1, tal como exige la regla de no
ocultar un dato no medible. Su salida completa se adjunta al PR.

Una falla para leer CI, commits o el historial necesario no se convierte en
cero: la fila dice `no medible` y el proceso sale con código 1. La prueba cubre
ese camino y la asociación positiva de corridas por SHA de commit.

## Decisiones que tomé sobre la marcha

- **Qué decidí:** asociar corridas de CI por SHA de cada commit del PR.
  **Qué otra opción había:** usar `workflow_runs[].pull_requests` o la rama.
  **Por qué elegí esta:** GitHub devuelve el arreglo `pull_requests` vacío aun
  para eventos `pull_request`, y una rama de promoción como `dev` mezcla PRs.

- **Qué decidí:** considerar sólo workflows cuyo nombre declara CI, E2E o
  Playwright.
  **Qué otra opción había:** contar todos los workflows de Actions.
  **Por qué elegí esta:** auto-etiquetado, auto-merge y métricas son controles
  de flujo; contarlos como intentos de CI inflaría el dato.

- **Qué decidí:** declarar no medible un issue con más de 100 eventos en vez de
  paginarlo sin límite.
  **Qué otra opción había:** usar la primera página como historia completa o
  recorrer todas las páginas.
  **Por qué elegí esta:** la primera falsifica la fecha `listo` y el recorrido
  ilimitado puede colgar el balance; el hueco visible conserva la honestidad de
  la métrica.

## Dónde el issue no alcanzaba

No definía cuáles eran los cuatro repos ni cómo distinguir una corrida de CI de
los workflows de gobernanza. Se tomó la unión ya declarada en
`.github/workflows/auto-merge.yml`: backend, frontend, admin y OS, y se dejó la
regla de nombres explícita en el script.

Tampoco definía cómo asociar una corrida con un PR cuando GitHub omite ese dato
en la respuesta REST. Se verificó la omisión y se documentó la asociación por
SHA como alternativa verificable.

## Qué quedó afuera

- Instrumentar Codex para exponer tokens: el issue lo deja fuera de alcance.
- Alterar el workflow histórico `metricas.yml`: registra otra serie por repo;
  este comando es un balance puntual de la tanda y no reescribe esa historia.

## Con qué se verifica

```text
Rojo: la prueba no pudo importar `scripts/balance-tanda.mjs` antes de crearlo.
Rojo: una expectativa de 30 minutos no coincidió con el fixture, que tenía una
hora entre `listo` y apertura; se corrigió el test, no el cálculo.
Verde: 2 pruebas focalizadas pasan, incluida CI inaccesible -> no medible + 1.
Verde: `npm run lint`, `npm run typecheck`, `npm run test` (1621 pasan, 4
omitidas) y `npm run check:tests-base` pasan.
```
