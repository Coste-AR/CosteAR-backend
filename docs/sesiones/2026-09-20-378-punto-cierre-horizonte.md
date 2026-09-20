---
issue: 378
repo: Coste-AR/CosteAR-backend
pr: 395
rama: feat/378-punto-cierre
agente: codex
modelo: gpt-5
tanda: B3
inicio: 2026-09-20T16:00:00-03:00
fin: 2026-09-20T16:15:08-03:00
minutos: 15
tokens: no-informado
clears: 0
intentos_hasta_verde: 2
rojos_deliberados: 1
rebotes_de_guarda: 0
---

# Sesión #378 — Punto de cierre con horizonte

## Recursos

- Preparación: `npm ci`, `npm run prisma:generate`.
- Verificación focal: `tests/domain/punto-cierre.test.ts`, familia M3-01, punto de equilibrio y
  contribución marginal.
- Verificación general: `npm run lint`, `npm run typecheck`, `npm test -- --maxWorkers=1`,
  `npm run check:tests-base`, `npm run check:openapi`, `npm run build`, `git diff --check`.
- Resultado final: 1.832 tests verdes y 4 skipped existentes; 22 operaciones OpenAPI coinciden.
- La primera general con dos workers tuvo un timeout de `owner-dashboard`; el archivo aislado pasó
  12/12 en 1,79 s y la general con un worker quedó verde sin cambiar tests ni límites.

## Rojo antes que verde

El test nuevo falló por módulo inexistente antes de implementar. El intento previo no contó como rojo
funcional porque el worktree todavía no tenía `node_modules` y Vitest no llegó a cargar la suite.

## Decisiones tomadas

1. **Conceptos valorizados como entrada del dominio.** La alternativa era repartir MP/MOD/CIP ya
   agregados. Se descartó porque el motor perdió la identidad de concepto y el reparto inventaría
   números. Constitución §2; detalle en ADR 0027.
2. **Horizonte como umbral mínimo.** `horizonteErogableMeses = 12` entra en el análisis de 12 meses
   y queda fuera del de 1 mes. La alternativa era interpretar el campo como vencimiento máximo, que
   contradice el criterio explícito de M1-01.
3. **Ausencia en vez de cero.** `erogable = null` o `true` sin horizonte devuelve motivo y valor
   ausente. Constitución §2.
4. **La sustitución cubre las catorce variantes de M3-01.** La mezcla multiproducto recibe sus CM
   financieras declaradas por producto; no se deriva una mezcla de un único perfil.

## Dónde el issue no alcanzaba

- Dice que los textos deben verse en pantalla, pero este repo no dibuja pantallas y M3-01 todavía no
  tiene endpoint. El dominio publica los textos exactos y los dos horizontes; el consumidor visual
  queda fuera de este repo.
- `ConceptoCosteo` no tiene importe y el motor no conserva el desglose por concepto. El issue no
  define una fuente persistida que una ambos. Se exigió el valor como entrada en vez de ampliar schema.
- No define qué significa `horizonteErogableMeses`; se interpretó como el primer horizonte en el que
  el desembolso es exigible, consistente con el criterio M1-01 (12 entra a 12 y no a 1).

## Qué quedó afuera

- UI: seguimiento `Coste-AR/CosteAR-frontend#194`, sin etiqueta `listo` hasta que exista contrato
  HTTP consumible.
- Endpoint de planeamiento que consuma estas funciones.
- Persistencia/versionado de importes por `ConceptoCosteo`.
- Cualquier reparto de los baldes agregados del motor.
