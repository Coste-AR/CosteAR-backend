# 2026-09-05 — El tablero nombra los supuestos pendientes

- **Issue:** #235
- **Repo:** CosteAR-backend
- **Rama:** `feat/tablero-parametros-pendientes`
- **PR:** pendiente
- **Agente:** Alan · Codex
- **Tanda:** B1

## Recursos

| | |
| --- | --- |
| Tiempo de la sesión | ~50 min |
| Tokens consumidos | no informado |
| Intentos hasta el verde | 2 (el primero de integración no inició sin `DATABASE_URL`; el segundo corrió con Postgres local y quedó verde) |
| Comandos de verificación corridos | `npm ci`, `npm run prisma:generate`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:http`, `npm run test:integration` |

## Qué se hizo

`GET /periods/:id/tablero-dueno` conserva el booleano
`parametrosSinConfirmar` y agrega `parametrosSinConfirmarDetalle`, una lista de
`{ id, nombre }` en cada número afectado. Así la interfaz puede explicar cuál
es el supuesto pendiente sin inferirlo a partir del valor calculado.

La consulta que antes contaba esos parámetros ahora los trae una sola vez para
todo el tablero. No se modificaron cálculos, escrituras ni el esquema.

## Decisiones que tomé sobre la marcha

- **Qué decidí:** exponer la lista como `parametrosSinConfirmarDetalle` junto
  al booleano existente, con objetos `{ id, nombre }`.
- **Qué otra opción había:** reemplazar el booleano por una lista, o devolver
  solamente la clave técnica.
- **Por qué elegí esta:** mantiene el contrato existente para consumidores
  actuales y da al frontend una identificación legible y estable.

- **Qué decidí:** formar `nombre` desde `descripcion` y usar `clave` como
  respaldo si la descripción falta o está vacía.
- **Qué otra opción había:** exigir que todos los parámetros tengan
  descripción o exponer un nombre vacío.
- **Por qué elegí esta:** `clave` es el identificador estable del modelo y el
  tablero no pierde explicabilidad por una descripción opcional ausente.

## Dónde el issue no alcanzaba

El issue exigía id y nombre mostrable, pero no definía el nombre del nuevo campo
ni la fuente del nombre. Se eligieron `parametrosSinConfirmarDetalle` y el
respaldo `descripcion ?? clave`; ambas decisiones quedan explícitas en el
contrato y en las pruebas.

## Qué quedó afuera

- Confirmar parámetros o cualquier otra escritura.
- Recalcular resultados, cambiar motivos o incompletitud.
- La marca visual del tablero, que corresponde al issue del frontend que
  consume este contrato.

## Con qué se verifica

```bash
npm run prisma:generate
# OK
npm run lint
# OK
npm run typecheck
# OK
npm test
# 168 archivos pasaron, 1 omitido; 1534 pruebas pasaron, 4 omitidas
npm run test:http
# 12 archivos, 75 pruebas: OK
npm run test:integration
# 15 archivos, 46 pruebas: OK (Postgres y RLS reales)
```
