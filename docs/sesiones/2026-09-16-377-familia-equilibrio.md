---
issue: 377
repo: CosteAR-backend
pr: 383
rama: feat/377-familia-equilibrio
agente: codex
modelo: gpt-5
tanda: B2
inicio: 2026-09-16T11:14:38-03:00
fin: 2026-09-16T11:26:58-03:00
minutos: 12.34
tokens: no-informado
clears: 0
intentos_hasta_verde: 2
rojos_deliberados: 1
rebotes_de_guarda: 0
---

# 2026-09-16 — Familia de equilibrio y seis despejes

## Recursos

Tiempo medido desde la primera lectura del reloj; el briefing y la selección
inicial ocurrieron antes de esa lectura y no están incluidos en minutos.
Tokens no informado. Una corrida deliberada del archivo nuevo dejó sus 32
casos rojos antes de implementar. La corrida inicial general tuvo tres timeouts
de arranque HTTP; sus archivos pasaron con la suite HTTP separada.
La repetición general usa dos workers y conserva los mismos límites y tests.
Un intento prematuro de prisma/vitest ocurrió mientras npm ci seguía corriendo;
falló por binarios aún ausentes. Se repitió después de completar la instalación.
La primera redirección de logs a .git falló porque en un worktree .git es archivo;
los logs de verificación se guardaron en TEMP y esos comandos se ejecutaron allí.

## Qué se hizo

Se agregó un formulario puro para equilibrio físico, monetario por razón y
marcación, razón de contribución, utilidad objetivo, mezcla y seis despejes.
Cada respuesta nueva tiene unidad y conceptos declarados. El equilibrio
existente conserva su número y fecha y agrega conceptos de origen.
AM-01 reconcilia quince cifras del flujo producción/venta y mantiene stock
final 42.800, contribución unitaria 256 y equilibrio 750. AM-01b da 512.000.

## Decisiones que tomé sobre la marcha

- Entrada discriminada por fórmula y contexto obligatorio, en lugar de un
  objeto con parámetros opcionales: el compilador exige los datos de cada
  operación. Constitución §2 y §3; ADR 0024.
- Mezcla con participaciones finitas, no negativas y suma exacta uno; la
  alternativa era normalizar. Se declara ausencia para no cambiar la mezcla
  sin avisar. Constitución §2.
- tramoValidez null hasta #380 (M10-01), en lugar de inventar capacidad infinita.
  El tipo histórico permite fotos sin estos metadatos. Constitución §2.
- Resultado actual admite pérdidas, incluso con cm negativo; la alternativa
  era ocultarlo con la guarda de equilibrio. El despeje describe el resultado
  y no afirma que exista equilibrio. La guarda sigue vigente en las divisiones.

## Dónde el issue no alcanzaba

No fijaba nombres ni forma de invocar las funciones, unidad de respuesta,
tolerancia de participaciones ni tratamiento de valores no finitos.
Se eligió Decimal, rechazo de mezclas incompletas con motivo y unidades
explícitas; no se publicó un endpoint que el issue no pedía.
La existencia final se verifica consumiendo la contribución marginal existente,
sin agregar valuación de stock a las fórmulas de equilibrio.

## Qué quedó afuera

Tramos y capacidad física: #380. Planeamiento sobre capital: M3-02.
Pantallas y endpoints de planeamiento. No hubo migraciones, queries ni cambios
de RLS; integración y DB no se ejecutaron porque no se tocó ese alcance.
No se mergea ni se agrega auto-merge.
Se omitió #348 por la instrucción /agente de esperar CIRCUITO_PAT; #374 mantiene
la pregunta financiera ya publicada, sin respuesta nueva. #360, #367, #372 y
#373 tienen PR abierto. No se duplicaron sus comentarios ni su implementación.

## Con qué se verifica

```text
npm ci — completo
npm run prisma:generate — verde
npx vitest run tests/domain/familia-punto-equilibrio.test.ts — 32 rojos antes del cambio
npx vitest run tests/domain/familia-punto-equilibrio.test.ts tests/domain/punto-equilibrio.test.ts tests/domain/contribucion-marginal.test.ts — 50 verdes en primer cambio
npm run lint — verde
npm run typecheck — verde
npm test — 1764 passed, 3 timeouts, 4 skipped
npm test -- --maxWorkers=2 — 1767 passed, 4 skipped
npx vitest run tests/domain/familia-punto-equilibrio.test.ts tests/domain/punto-equilibrio.test.ts tests/domain/contribucion-marginal.test.ts — 53 passed, con las quince cifras exactas de la clave §9.1
npm run test:http — 122 passed
npm run check:tests-base — verde
npm run check:openapi — verde
npm run typecheck:openapi-consumer — verde
```

## Entrega y CI

PR #383 contra dev, actualizado con gh pr update-branch. Commit funcional d8c377d;
cierre de metadatos de92fb5. CI completo verde en la corrida 35108225735:
build-and-test, integration-tests y e2e-tests. Se agrega este cierre documental
y se comprueban sus checks antes de marcar listo. El fin medido corresponde a
esta redacción después del CI; el monitoreo posterior se registra en memoria
de la automation. Etiqueta codex; codex-automation no existe en el repositorio.
