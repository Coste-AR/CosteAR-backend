---
issue: 423
repo: CosteAR-backend
pr: 433
rama: feat/423-planeamiento-resultados
agente: codex
modelo: gpt-5
tanda: B3
inicio: 2026-09-23T16:36:09-03:00
fin: 2026-09-23T16:54:11-03:00
minutos: 18
tokens: no-informado
clears: 0
intentos_hasta_verde: 4
rojos_deliberados: 2
rebotes_de_guarda: 0
---

# 2026-09-23 — Cuánto vender para alcanzar un resultado

## Recursos — qué significa cada campo

La primera ejecución no llegó a los tests porque el worktree no tenía dependencias; se corrió `npm ci` y `npm run prisma:generate`. El primer rojo efectivo confirmó que todavía no existían el cálculo ni la ruta. Hubo dos ajustes durante el ciclo: precisión del valor esperado y estrechamiento del tipo de objetivo después de la guarda HTTP. La primera corrida de `test:db` usó por error el rol restringido para sembrar; la corrida válida usó el dueño para fixtures y `costear_app` como sonda RLS.

## Qué se hizo

- Se agregaron las fórmulas físicas y monetarias de AM5 para objetivos absolutos y porcentuales sobre capital, sin redondear resultados intermedios.
- Se publicó `POST /companies/{companyId}/analisis/planeamiento-resultados`, autenticado y limitado al tenant, con `cantidadNecesaria`, `ventasNecesarias`, `resultadoLogrado` y `basadoEn`.
- Se aplicó R12: los porcentajes sobre ventas o costos devuelven 422 y explican el contraejemplo de Yardín.
- Se declaró ausencia cuando la contribución disponible no es positiva y se publicaron las unidades recibidas, siguiendo Constitución §2 y §3.
- Se actualizó el contrato OpenAPI y sus tipos de consumidor.

## Decisiones que tomé sobre la marcha

- **Qué decidí:** conservar un único endpoint con una unión discriminada por `modalidad` (`fisica` o `monetaria`).
- **Qué otra opción había:** dos endpoints o aceptar simultáneamente precio, costo variable y marcación aunque una mitad no se usara.
- **Por qué elegí esta:** evita combinaciones ambiguas y hace explícita la fórmula aplicada sin ampliar el alcance.

- **Qué decidí:** exigir `unidadCantidad` en la modalidad física y `moneda` en ambas; la respuesta las devuelve junto a los valores.
- **Qué otra opción había:** inferir “unidades” y “ARS” desde el contexto o publicar números sin unidad.
- **Por qué elegí esta:** Constitución §3 exige que la unidad viaje con el valor y prohíbe deducirla de un texto o rubro.

- **Qué decidí:** autorizar la empresa mediante una consulta tenant aunque el cálculo sea puro.
- **Qué otra opción había:** usar `companyId` sólo como parte decorativa de la URL.
- **Por qué elegí esta:** una ruta bajo `/companies/{companyId}` no debe confirmar ni operar sobre una empresa ajena.

## Dónde el issue no alcanzaba

- No definía la forma exacta del body; se eligieron nombres en castellano y una unión discriminada que refleja las dos fórmulas del plan.
- No definía cómo acompañar unidades; se hicieron obligatorias por Constitución §3.
- No decía si persistir escenarios. Se mantuvo el cálculo puro porque no se pidió modelo, historial ni mutación.

## Qué quedó afuera

- La pantalla frontend, explícitamente fuera del alcance de #423.
- Persistencia o comparación de escenarios, no solicitadas por el issue.

## Con qué se verifica

```bash
npm run lint                         # verde
npm run typecheck                    # verde
npm run test                         # 1.922 verdes, 4 omitidos
npm run test:http                    # 177 verdes
npm run test:integration             # 87 verdes
npm run test:db                      # 67 verdes
npm run check:openapi                # verde, 49 operaciones tipadas
npm run typecheck:openapi-consumer   # verde
npm run check:tests-base             # verde
```
