---
issue: 380
repo: Coste-AR/CosteAR-backend
pr: 405
rama: feat/380-equilibrio-tramos
agente: codex
modelo: gpt-5
tanda: B2
inicio: 2026-09-21T14:02:35-03:00
fin: 2026-09-21T14:30:00-03:00
minutos: 27
tokens: no-informado
clears: 0
intentos_hasta_verde: 2
rojos_deliberados: 2
rebotes_de_guarda: 0
---

# Sesión #380 — equilibrio por tramos

## Recursos

- Comandos: `npm run briefing`, `npm ci`, `npm run prisma:generate`, `npm run lint`, `npm run typecheck`, `npm run build`, `npm run test`, `npm run test:http`, `npm run test:integration`, `npm run test:db`, guardas de tests y OpenAPI.
- Verificación final: 1.864 unitarios, 145 HTTP, 82 integración/RLS y 66 DB verdes; 28 operaciones OpenAPI.
- El primer rojo fue el módulo de dominio inexistente. El segundo fue el contrato HTTP que rechaza `techoFisico` sin `techoFuente`.
- La primera instalación de dependencias quedó incompleta; se conservó como `node_modules.incomplete-20260921` y se repitió `npm ci` limpio.

## Decisiones tomadas

- Se eligió una tabla versionada separada de `ConceptoCosteo`, en lugar de columnas mutables, para que cada cálculo pueda citar la versión exacta.
- `segmentoId` queda como UUID sin FK porque `SegmentoAnalisis` pertenece a M4-01 y todavía no existe; exigir esa tabla ampliaría el alcance. La restricción SQL exige exactamente concepto o segmento.
- `GET .../equilibrio` previsualiza; `POST .../equilibrio` persiste una foto auditable. Hacer que un GET mutara habría roto la semántica HTTP.
- Hasta #401, la cuenta dueña se identifica con `Company.userId`, no con un valor `EMPRESA_ADMIN` que todavía no existe en el enum.

## Dónde el issue no alcanzaba

- No definía la semántica matemática de `ACUMULA`. Se conserva la contribución obtenida en escalones anteriores y el `cm` nuevo se aplica sólo sobre las unidades por encima de `desde`.
- No definía si una previsualización debía persistir. Se separaron lectura y cálculo auditado en GET/POST.

## Qué quedó afuera

- La pantalla, explícitamente correspondiente al frontend.
- El modelo de capacidad productiva por unidad; la decisión K lo deja fuera.
- Una FK de `segmentoId`, hasta que M4-01 cree la entidad correspondiente.
- Pantalla seguida en `Coste-AR/CosteAR-frontend#197`.
