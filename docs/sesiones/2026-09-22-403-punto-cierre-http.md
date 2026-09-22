---
issue: 403
repo: Coste-AR/CosteAR-backend
pr: pendiente
rama: feat/403-punto-cierre-http
agente: codex
modelo: gpt-5
tanda: B3
inicio: 2026-09-22T13:16:23-03:00
fin: 2026-09-22T13:35:00-03:00
minutos: 19
tokens: no-informado
clears: 0
intentos_hasta_verde: 2
rojos_deliberados: 1
rebotes_de_guarda: 0
---

# Sesión #403 — contrato HTTP del punto de cierre

## Resultado

- Se agregó el importe nominal por `ConceptoCosteo` como versión inmutable, con vigencia, moneda y unidad.
- Se publicaron la escritura del importe y la lectura del punto de cierre por horizontes en OpenAPI.
- AM-01 devuelve 375 a un mes, 593,75 a doce meses y la situación doctrinaria a 650 unidades.
- La migración aditiva y las políticas RLS se probaron desde una base vacía.

## Recursos

- Comandos: `npm ci`, `npm run prisma:generate`, `npm run lint`, `npm run typecheck`, `npm test -- --maxWorkers=1`, `npm run test:http -- --maxWorkers=1`, `npm run test:integration`, `npm run test:db`, `npm run build`, `npm run check:tests-base`, `npm run check:openapi`, `npm run typecheck:openapi-consumer`.
- El primer intento focalizado tuvo un timeout preexistente en el caso de `TramoCosto`; con un worker quedaron 18/18 verdes. La regresión completa terminó verde.
- Rojo deliberado: Postgres rechazó actualizar una versión de importe por el trigger append-only.

## Decisiones tomadas

- Se eligió una tabla separada de importes frente a agregar columnas a `ConceptoCosteo`, para no duplicar ni pisar la clasificación. Alternativas y consecuencias: ADR 0030.
- La vigencia se resuelve por la última versión con `vigenteDesde <= vigenteEn`; empates usan `createdAt`.
- Precio unitario, equilibrio económico y actividad son insumos explícitos del GET porque el issue no define un período o cálculo canónico del cual obtenerlos. La respuesta los devuelve sin alterarlos.
- Un importe ausente invalida solamente los horizontes que lo necesitan. Un concepto no erogable no exige importe para el punto de cierre.
- Se aplicó Constitución §2: ninguna ausencia cae al agregado MP/MOD/CIP.

## Dónde el issue no alcanzaba

- No definía la fuente HTTP de precio, equilibrio económico ni actividad; se eligieron query params explícitos y tipados.
- No definía cómo reproducir sin escribir desde un GET; se devuelven los IDs inmutables de versiones utilizadas y `vigenteEn` permite seleccionar la foto temporal.

## Qué quedó afuera

- Pantalla `Coste-AR/CosteAR-frontend#194`.
- Reparto de MP/MOD/CIP agregados.
- Conversión a moneda homogénea; el contrato declara `nominal: true`.
