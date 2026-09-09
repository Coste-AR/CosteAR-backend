# Bitácora — issue #291: chunker recursivo con solape

## Qué se hizo

`chunkMarkdown` seguía partiendo solo por H2/H3 y una nota sin subtítulos (o una sección muy
larga) quedaba como un chunk gigante que diluye el embedding. Cambios:

- **Troceo recursivo**: una sección que supera `MAX_CHUNK_CHARS` (~3200, ≈800 tokens con la
  heurística 4 chars/token) se subdivide por párrafos; un párrafo que solo ya lo supera se
  subdivide por oraciones (sin cortar a mitad de oración).
- **Solape de un párrafo** entre trozos contiguos de la misma sección: el último párrafo de un
  trozo se repite al inicio del siguiente. No hay solape entre secciones distintas.
- **Niveles 4-6 (`####`..`######`)** ahora abren sección y aportan al `headingPath`
  (`CIP > Prorrateo > Base horas máquina`) en vez de aplanarse como contenido. El `stack` se
  recorta al subir de nivel, así un `###` después de un `####` vuelve a profundidad 3.
- `contentHash` sin cambios (`sha256(headingPath + "\n" + content)`); F1-05 lo ajustará para
  incluir el prefijo contextual.

## Decisiones

- **Sin tokenizador**: no hay uno en el stack y sumar `tiktoken`/`gpt-tokenizer` por un umbral
  aproximado no se justifica. `MAX_CHUNK_CHARS` es una heurística documentada; los evals de F1-12
  van a decir si hay que afinarla.
- **`splitSentences` con regex** (`[^.!?…]+[.!?…]+...`): imperfecto para abreviaturas ("etc.",
  "Sr."), pero solo se usa cuando un párrafo solo ya pasa el techo — un caso de borde raro en la
  bóveda. Se prioriza no cortar a mitad de oración.
- **El solape puede empujar un chunk un poco por encima del techo** (un párrafo extra). Es
  aceptable: el objetivo del techo es que el embedding no se diluya, no un límite duro.

## Fuera de alcance

Contextual Retrieval / prefijo por chunk (#297, F1-05). Re-embeddeo (lo hace el indexador por
hash). Cambiar el modelo de embeddings.

## Verificación

```
npm run typecheck                          # verde
npx eslint <archivos tocados>              # sin errores
npx vitest run tests/vault-indexer/        # 29 verdes (16 del chunker)
npx vitest run --exclude 'tests/http/**'   # 1486 verdes, 1 skip
```

6 tests nuevos en `markdown-chunker.test.ts`: sección corta = 1 chunk (sin cambios), sección
larga = varios chunks con mismo `headingPath` y `chunkIndex` correlativo, solape del último
párrafo, párrafo enorme partido por oraciones sin cortar, H4-6 en `headingPath`, y el recorte del
stack al volver de `####` a `###`. Los 10 tests previos siguen pasando.

No toca DB ni endpoints → `test:integration` / `test:http` no aplican.
