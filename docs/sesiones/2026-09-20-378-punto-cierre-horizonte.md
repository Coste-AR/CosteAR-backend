---
issue: 378
repo: Coste-AR/CosteAR-backend
pr: pendiente
rama: feat/378-punto-cierre
agente: codex
modelo: gpt-5
tanda: B3
inicio: 2026-09-20T16:00:00-03:00
fin: pendiente
minutos: pendiente
tokens: no-informado
clears: 0
intentos_hasta_verde: pendiente
rojos_deliberados: 1
rebotes_de_guarda: 0
---

# Sesión #378 — Punto de cierre con horizonte

## Recursos

- Preparación: `npm ci`, `npm run prisma:generate`.
- Verificación focal: `tests/domain/punto-cierre.test.ts`, familia M3-01, punto de equilibrio y
  contribución marginal.
- Verificación general: se completa antes del PR.

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

- UI y endpoint de planeamiento que consuman estas funciones.
- Persistencia/versionado de importes por `ConceptoCosteo`.
- Cualquier reparto de los baldes agregados del motor.
