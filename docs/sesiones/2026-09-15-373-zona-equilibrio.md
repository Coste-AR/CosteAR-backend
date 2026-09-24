---
issue: 373
repo: CosteAR-backend
pr: 382
rama: feat/373-zona-equilibrio
agente: codex
modelo: gpt-5
tanda: B2
inicio: 2026-09-15T21:55:00-03:00
fin: 2026-09-15T22:23:00-03:00
minutos: 28
tokens: no-informado
clears: 0
intentos_hasta_verde: 2
rojos_deliberados: 0
rebotes_de_guarda: 0
---

# 2026-09-15 — El equilibrio incompleto deja de quedar en blanco

## Recursos

| | |
| --- | --- |
| Tiempo de la sesión | 28 min |
| Tokens consumidos | no informado |
| Intentos hasta el verde | 2 |
| Comandos de verificación corridos | `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:http`, `npm run check:tests-base`, `npm run check:openapi`, `npm run typecheck:openapi-consumer` |

## Qué se hizo

- El punto de equilibrio ahora distingue `punto` de `zona`.
- Si el único faltante es clasificar importes conocidos, devuelve los extremos suponiéndolos todos
  variables y todos fijos, más la lista de conceptos que ensanchan el intervalo.
- El tablero y el resultado de cálculo convierten ambos extremos y sus aportes a la unidad de
  gestión, sin fabricar un valor único.
- AM-07 queda cubierto con `[709,09; 793,55]`, CIP por 90.000 nombrado y 750 dentro de la zona.

## Decisiones que tomé sobre la marcha

- **Qué decidí:** la zona sólo nace si la falta de clasificación es el único bloqueo.
  **Qué otra opción había:** devolver cotas aun con ventas, precio o controles ausentes.
  **Por qué elegí esta:** esos faltantes no son incertidumbre acotable y podrían invalidar ambos
  extremos.
- **Qué decidí:** atribuir `aporteAlAncho` con pasos ordenados por clave.
  **Qué otra opción había:** prorratear el ancho por importe.
  **Por qué elegí esta:** el paso mide el efecto real en la fórmula y deja una suma reproducible.
- **Qué decidí:** conservar `unidadesEquilibrio: null` para una zona.
  **Qué otra opción había:** completar el campo con un promedio o un extremo.
  **Por qué elegí esta:** cualquier número único contradice R13 y rompería consumidores silenciosamente.

## Dónde el issue no alcanzaba

- No definía cómo distribuir `aporteAlAncho` cuando hay más de un concepto; se fijó un orden estable
  y se documentó en ADR 0023.
- `ConceptoCosteo` no guarda el importe que le corresponde dentro del balde agregado que emite el
  motor. La implementación nombra y acota los componentes que la contribución marginal sí puede
  auditar; no inventa una distribución entre conceptos sin identidad monetaria.
- No aclaraba cómo proyectar una zona a la unidad de gestión ni cómo conservar compatibilidad con
  `unidadesEquilibrio`; ambos extremos y aportes se convierten, y el campo histórico queda `null`.

## Qué quedó afuera

- La pantalla del frontend: este repo entrega el contrato backend; no se modifica otro repo.
- El reparto de un balde entre varios `ConceptoCosteo`: falta identidad e importe individual en la
  salida del motor, y ampliar ese contrato no forma parte de #373.
- No se corrieron suites de base: no hubo cambios de Prisma, RLS ni queries.

## Con qué se verifica

```text
npm run lint                         verde
npm run typecheck                    verde
npm test                             1737 passed, 4 skipped
npm run test:http                    123 passed
npm run check:tests-base             verde
npm run check:openapi                verde
npm run typecheck:openapi-consumer   verde
```

La primera corrida general tuvo un timeout de arranque en `admin-stats` mientras inicializaba
queues sin `DATABASE_URL`; el archivo aislado pasó 2/2 y la repetición general pasó completa.
