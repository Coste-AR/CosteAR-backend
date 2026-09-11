# Bitácora — issue #294 (RAG F1-02, opción B): `.vaultignore` + `deriveSourceType`

## Contexto

F1-02 iba a mover la bóveda a `conocimiento/` vs `interno/`. Antes de arrancar apareció que el
09/09 un compañero **reestructuró `costear-knowledge-base`** (commit `c754d04`): borró
`001.1 - Clases (Mirta)/` y subió `001.1 - Teoría de Costos/` (88 notas) con taxonomía propia
(`Costos I`, `Costos II`, `Ruta de Aprendizaje`). Además varios archivos de
`Análisis Marginal (Yardín)/` tienen rutas de 220–305 caracteres: moverlos dentro de
`conocimiento/catedra/…` los rompería en Windows (límite de 260).

Se acordó con Giuliana la **opción B**: no mover archivos, solo `.vaultignore` + ajustar el
clasificador.

## Qué se hizo

### `costear-knowledge-base` (PR #2, contra `main`)

- **`.vaultignore`** nuevo en la raíz. Excluye del índice del RAG:
  `costeo-procesos/{spec,mockups,testing}/`, `costeo-procesos/README.md` (doc para devs, no
  metodología) y `Reportes_Nocturnos/` (salida futura del loop de curación F1-14).
- **`README.md`** — sección "Qué se indexa en el RAG" con el contrato del filtro
  (`vault-filter.ts`).

### `CosteAR-backend` (PR draft, contra `dev`)

- **`src/application/vault-indexer/vault-chunk-repository.ts`** — `deriveSourceType()` reconoce
  `001.1 - Teoría de Costos/` como `CATEDRA` (antes esa carpeta caía en `null` → se rompía el
  filtrado por namespace de F1-06). Normaliza a **NFC** antes de comparar: un checkout en macOS
  puede entregar el acento de "Teoría" descompuesto y `startsWith` no lo matchearía.
- **`tests/integration/vault-chunk-repository.test.ts`** — 5 casos nuevos: clases de Costos I/II,
  ruta profunda de `Análisis Marginal (Yardín)`, Ruta de Aprendizaje, separador `\` de Windows y
  ruta en forma NFD.

## Decisiones

- **Opción B, no A.** La reestructura tipo `conocimiento/`/`interno/` la tiene que hacer quien
  armó `001.1 - Teoría de Costos/`, poniéndose de acuerdo en la taxonomía. Hacerlo a ciegas ahora
  chocaría con su organización y con el límite de rutas de Windows.
- **`001.1 - Teoría de Costos/` entero → `CATEDRA`**, incluida la subcarpeta
  `001.1.3 - Ruta de Aprendizaje`: es material de estudio escrito por humanos, no las ediciones
  aprobadas por IA que `APRENDIZAJE` representa en F1-06/F1-14.
- **No se tocó el prefijo `costeo-procesos/` en `deriveSourceType`.** El `.vaultignore` ya saca
  `spec/mockups/testing/` del índice; solo llega `corpus-catedra/`.
- `core.longpaths=true` quedó seteado localmente en el repo bóveda (config local, no commiteado).

## Fuera de alcance

- Mover archivos a `conocimiento/`/`interno/` (opción A, queda para el equipo de la bóveda).
- F1-03 (auditoría de contenido de cátedra).

## Verificación

```
# filtro real contra la bóveda con el .vaultignore nuevo
listMarkdownFiles(costear-knowledge-base)  → 92 notas
  001.1 - Teoría de Costos/**            88
  costeo-procesos/corpus-catedra/**       4
  fugas (spec/mockups/testing/README)     0

npm run typecheck · eslint (archivos tocados)                       # verde
npx vitest run --config vitest.integration.config.ts \
  tests/integration/vault-chunk-repository.test.ts                  # 4 verdes (incl. deriveSourceType)
```
