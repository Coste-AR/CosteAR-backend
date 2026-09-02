# 2026-09-02 — Stock terminado por partida, sin saldo manual

- **Issue:** #198
- **Repo:** CosteAR-backend
- **Rama:** `codex/issue-198-stock-variante`
- **PR:** pendiente
- **Agente:** Alan · Codex
- **Tanda:** B1

## Recursos

| | |
| --- | --- |
| Tiempo de la sesión | ~30 min |
| Tokens consumidos | no informado |
| Intentos hasta el verde | 2 |
| Comandos de verificación corridos | `npx prisma generate`, `npx tsc --noEmit`, `npx eslint src tests`, `node scripts/check-tests-con-base.mjs`, `npx vitest run`, `npx vitest run tests/http --reporter=dot --silent`, `npx vitest run --config vitest.integration.config.ts --reporter=dot --silent` |

## Qué se hizo

Se agregó el stock terminado derivado por variante y por partida de producción.
Cada partida conserva su fecha, por lo que la respuesta informa tanto el saldo
disponible como sus días de vida y si superó la vida útil resuelta por parámetro.

Los egresos se registran contra una partida y se rechazan antes de llevarla a un
saldo negativo. No existe una columna ni una tabla de saldo editable. Se sumaron
migración aditiva, RLS, rutas de consulta/egreso y prueba de integración con el
rol de aplicación sin `BYPASSRLS`.

## Decisiones que tomé sobre la marcha

- **Qué decidí:** llevar el stock por partida de `ProduccionDiaria`, no como un
  único total por variante.
- **Qué otra opción había:** materializar un total por variante y actualizarlo
  en cada hecho.
- **Por qué elegí esta:** la partida conserva la fecha necesaria para conocer
  edad y vencimiento; un total perdería ese dato o exigiría duplicarlo.

- **Qué decidí:** registrar un `EgresoProducto` genérico por partida, sin datos
  de venta.
- **Qué otra opción había:** crear ahora una entidad de venta.
- **Por qué elegí esta:** A-15 todavía no modela ventas. El hecho genérico deja
  un punto de enlace para ese issue sin adelantar precios, canales ni documentos.

- **Qué decidí:** resolver `vida_util_producto_dias` desde el catálogo de
  parámetros, con un valor de referencia no confirmado.
- **Qué otra opción había:** usar una constante en el servicio o no exponer un
  límite hasta que se cargara un parámetro.
- **Por qué elegí esta:** el límite cambia y debe quedar visible como parámetro,
  con su origen y confirmación, en vez de esconder una regla fija en el código.

## Dónde el issue no alcanzaba

El issue no definía si el egreso previo a ventas debía tener semántica comercial.
Se asumió que es un hecho físico genérico por partida; la asociación con ventas
queda explícitamente para A-15.

El issue tampoco fijaba un valor inicial de vida útil. Se usó un valor de
referencia no confirmado dentro del catálogo editable, no un dato de una empresa.

## Qué quedó afuera

- Ventas, canales, precios y comprobantes: corresponden a A-15.
- Alertas y umbrales operativos sobre producto próximo a vencer: no fueron parte
  de este issue.
- Asignación automática de un egreso entre varias partidas: el egreso se carga
  contra una partida para no inventar un criterio de rotación.

## Con qué se verifica

```bash
npx prisma generate                         # OK
npx tsc --noEmit                             # OK
npx eslint src tests                         # OK
node scripts/check-tests-con-base.mjs        # OK
npx vitest run --silent --reporter=dot <primera mitad de archivos>
# 78 archivos, 761 tests: OK
npx vitest run --silent --reporter=dot <segunda mitad de archivos>
# 90 archivos, 681 tests: OK
npx vitest run tests/http --reporter=dot --silent
# 11 archivos, 73 tests: OK
npx vitest run --config vitest.integration.config.ts --reporter=dot --silent
# 12 archivos, 37 tests: OK; RLS aplicado con rol de aplicación sin BYPASSRLS
```
