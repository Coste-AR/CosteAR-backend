# 2026-09-01 — Conectar vocabulario de rubro al clasificador

- **Issue:** #182
- **Repo:** CosteAR-backend
- **Rama:** `codex/issue-182-vocabulario`
- **PR:** pendiente
- **Agente:** Codex
- **Tanda:** B1

## Recursos

| | |
| --- | --- |
| Intentos hasta el verde | 2 para la prueba unitaria nueva; el primer intento conservaba la llamada de un mock entre casos |
| Comandos de verificación corridos | `npm ci`, `npm run prisma:generate`, `npm run lint`, `npm run typecheck`, `npm run test:http`, `npm run test:integration` |

## Qué se hizo

El cascade lee las filas activas de `VocabularioTermino` filtradas por la categoría del rubro y
agrega cada término y variante a las mismas listas de señales que ya consume Layer 4. Layer 4
recibe ese perfil extendido, sin cambiar sus pesos, umbrales ni el orden de las capas. Si una
ejecución offline no tiene `DATABASE_URL`, conserva el perfil estático que ya usaba.

Se agregaron pruebas unitarias para el mapeo y el filtro por rubro, y una prueba de integración
que crea una fila sintética. Esta última verifica una variante exclusiva de la tabla, que deja de
clasificar al desactivarla, y que no se aplica a otro rubro.

## Decisiones que tomé sobre la marcha

- **Qué decidí:** Mapear solo `MATERIA_PRIMA`, `COSTOS_INDIRECTOS` y `MANO_DE_OBRA` a las listas
  existentes de Layer 4.
- **Qué otra opción había:** Inventar reglas nuevas para `VENTAS` y `NO_APLICA`.
- **Por qué elegí esta:** El issue prohíbe cambiar la lógica de decisión y Layer 4 solo tiene
  listas de keywords para esas tres secciones. Las otras dos siguen siendo datos de dominio, sin
  una ruta de compra equivalente donde agregarlas sin ampliar alcance.

- **Qué decidí:** Mantener las keywords estáticas y sumar las de base de datos en cada
  clasificación.
- **Qué otra opción había:** Reemplazar el perfil estático por la tabla.
- **Por qué elegí esta:** La tabla complementa al perfil; reemplazarlo cambiaría las señales
  existentes y contradice el límite del issue.

## Dónde el issue no alcanzaba

- El issue no define cómo deben participar las filas con sección `VENTAS` o `NO_APLICA`. Se
  asumió que no se convierten en señales de Layer 4 porque no existe una lista ni un ruteo de
  compras para esas secciones. La decisión quedó aislada en `vocabulary-profile.ts`.
- El comentario de `industry-profile.ts` citado por el issue solo excluye deliberadamente un caso
  contable que el modelo actual no representa; no contradice usar las demás filas activas de
  vocabulario. Por eso no se modificó ese archivo.

## Qué quedó afuera

- No se modificaron `prisma/schema.prisma`, la semilla, `industry-profile.ts`, pesos, umbrales ni
  el orden del cascade.
- No se agregaron términos de negocio: los tests usan textos y conceptos sintéticos.
- `npm run test:integration` no pudo ejecutar pruebas porque Docker Desktop no está iniciado y
  Postgres local no responde en `localhost:5433`. El fallo ocurrió durante el setup de migraciones,
  antes de recolectar tests; queda para que CI o un entorno con Postgres lo ejecute.

## Con qué se verificó

```bash
npm run prisma:generate
# cliente Prisma generado

npx vitest run tests/classifier/vocabulary-profile.test.ts tests/classifier/cascade.test.ts
# 2 archivos, 9 tests en verde

npm run lint
# sin errores

npm run typecheck
# sin errores

npm run test:http
# 11 archivos, 73 tests en verde

npm run test:integration
# bloqueado antes de los tests: P1001, Postgres local no disponible en localhost:5433
```
