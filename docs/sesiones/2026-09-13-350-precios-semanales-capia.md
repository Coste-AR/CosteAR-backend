---
issue: 350
repo: CosteAR-backend
pr: 352
rama: feat/capia-indicadores-semanales
agente: codex
modelo: gpt-5
tanda: B2
inicio: 2026-09-13T16:55-03:00
fin: 2026-09-13T17:11-03:00
minutos: 16
tokens: no-informado
clears: 0
intentos_hasta_verde: 2
rojos_deliberados: 1
rebotes_de_guarda: 0
---

# 2026-09-13 — CAPIA entra como referencia semanal sin inventar precios

## Qué se hizo

- Se agregó un adaptador defensivo para la encuesta vigente de CAPIA, probado contra los 21 ítems de la respuesta real del 13-09-2026.
- Cada producto queda identificado por un código estable, una unidad declarada, su IVA y el rango de vigencia de la semana.
- La sincronización externa guarda una fila por producto y semana. Si CAPIA falla o cambia el contrato, no guarda nada ni copia la semana anterior.
- La interfaz puede leer la última semana guardada desde `GET /api/v1/indicadores/capia/vigentes`; sin filas recibe `semana: null` e `items: []`.

## Decisiones que tomé sobre la marcha

- **Qué decidí:** usar `effectiveDate` como inicio de semana y guardar `effectiveTo`, unidad, IVA, título y producto en `metadata`.
  **Qué otra opción había:** agregar columnas específicas de CAPIA a `macro_snapshots`.
  **Por qué elegí esta:** el issue pide usar la tabla y el servicio existentes; los metadatos ya son el punto de extensión de fuentes externas y la clave única existente garantiza una fila por fuente, código y semana.
- **Qué decidí:** mantener el endpoint autenticado, igual que `/macro/latest` y `/macro/history`.
  **Qué otra opción había:** hacerlo público como `/macro/landing`.
  **Por qué elegí esta:** es un insumo de la interfaz operativa, no de la vitrina pública.
- **Qué decidí:** incorporar CAPIA al job recurrente `macro-sync` sin disparar recálculos.
  **Qué otra opción había:** crear otra cola recurrente.
  **Por qué elegí esta:** reutiliza la corrida existente que ya sincroniza fuentes y CAPIA es informativo hasta que otro issue defina su uso en cálculos.

## Dónde el issue no alcanzaba

- No definía si el endpoint liviano era público; se mantuvo la política autenticada de los indicadores operativos.
- No definía columnas para `effectiveTo`, unidad, IVA ni etiqueta. Se usó `metadata` para no especializar la tabla compartida ni ampliar la migración.
- La primera ejecución local de `db:setup` usó por error el rol restringido que figura como `DATABASE_URL` en `.env.example`; Prisma necesita el rol dueño para alterar el enum. Se marcó la migración local fallida como revertida y se aplicó de nuevo con el rol dueño. No se modificaron datos de ningún ambiente compartido.

## Qué quedó afuera

- El histórico previo de CAPIA, usar sus referencias en el cálculo y mostrarlas en frontend. Son los límites explícitos del issue.
- El filtrado visual por paquete/tenant: backend conserva todos los productos; la selección de presentación queda del lado del paquete consumidor, sin condicionales por cliente.

## Con qué se verifica

```bash
npm run prisma:generate       # verde
npm run lint                  # verde
npm run typecheck             # verde
npm run check:tests-base      # verde
npm test                      # 190 archivos, 1651 tests; verde al segundo intento
npm run test:http             # 19 archivos, 105 tests; verde
npm run db:setup              # 81 migraciones y 189 sentencias RLS; verde con rol dueño
npm run test:integration      # 22 archivos, 69 tests; verde con rol sin BYPASSRLS
```

La primera corrida completa de `npm test` tuvo un timeout aislado en `tests/http/admin-stats.test.ts`; el archivo pasó solo al reintento y la suite completa pasó después sin cambios. El rojo deliberado fue la corrida inicial del test del adaptador antes de crear `capia.ts`.
