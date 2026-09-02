# Bitácora — issue #189: contribución marginal por unidad

## Decisión y supuesto explícito

El motor de absorción de Órdenes ya emite tres importes consolidados y trazables:
materia prima consumida, mano de obra directa y costos indirectos aplicados. No
expone un importe absorbido por cada renglón interno de CIF, por lo que la
clasificación de esta primera vista se resuelve para esos tres rubros con las
claves estables `comportamiento_materia_prima`,
`comportamiento_mano_obra_directa` y `comportamiento_costos_indirectos`.

Es un supuesto necesario porque el issue exige reutilizar exactamente los
importes de absorción y no modificar ese motor. Se registra junto a la corrida
en `CalculationRun.results.contribucionMarginal`, con la fila de parámetro,
alcance, autor y fecha que decidió cada rubro. A-04 puede proponer y confirmar
esas mismas claves; no se agregó ningún default aquí.

`SEMIFIJO` se reporta como incompleto. Con la clasificación disponible no existe
todavía una proporción o un tramo que separe su parte variable; contarlo entero
como variable o como fijo inventaría un dato. También queda incompleto si falta
una clasificación o si no hay unidades vendidas para dividir.

## Alcance deliberadamente fuera

No se modificó el motor de absorción, no se agregó punto de equilibrio (A-06),
ni endpoint de lectura (A-07), ni se implementó la semilla o la confirmación de
clasificaciones (A-04).

## Verificación

- `npm ci --force`
- `npm run prisma:generate`
- `npm run lint`
- `npm run typecheck`
- `npm test -- --reporter=dot --silent` (sin fallas reportadas; el proceso terminó
  luego de la salida parcial de la consola)
- `npm run test:integration -- --reporter=dot` con `DATABASE_URL` del rol
  `costear_app` sin `BYPASSRLS` y `MIGRATION_DATABASE_URL` del dueño: 4 archivos,
  16 tests verdes.
- `npm run check:tests-base` — verde. La nueva prueba vive bajo
  `tests/integration/**`, patrón incluido por `CON_ROL_DE_APP`: usa Prisma y
  `withTenant`, no SQL crudo, por lo que corre con el rol de aplicación.
