---
issue: 414
repo: CosteAR-backend
pr: 416
rama: feat/alertas-contrato-414
agente: codex
modelo: gpt-5
tanda: B3
inicio: 2026-09-22T23:23-03:00
fin: 2026-09-22T23:44-03:00
minutos: 21
tokens: no-informado
clears: 0
intentos_hasta_verde: 7
rojos_deliberados: 1
rebotes_de_guarda: 0
---

# 2026-09-22 — Alertas con contexto visible y ausencia declarada

## Qué se hizo

- La bandeja de alertas publica severidad, clave y etiqueta del indicador, unidad del valor, unidad del umbral y motivo no evaluado.
- Las reglas sin datos crean un registro consultable y su entrada de trazabilidad en la misma transacción.
- El paquete avícola declara el catálogo de indicadores configurables con etiquetas visibles y unidades.
- OpenAPI publica la bandeja, el catálogo por rubro y el resultado de evaluación.
- Se agregó `npm run verificar` como agregador de las guardas que el criterio de aceptación exigía ejecutar.

## Recursos

- Dependencias instaladas con `npm ci` y cliente generado con `npm run prisma:generate`.
- `npm run verificar`: lint, typecheck, 1901 tests unitarios, 166 HTTP, OpenAPI, consumidor tipado y guarda de tests con base en verde.
- `npm run test:integration`: 28 archivos y 86 tests en verde con PostgreSQL y RLS real.
- `npx prisma validate`: schema válido.
- `npm run test:db`: 25 tests pasaron; un caso de evidencia no arrancó porque la configuración local no contiene una clave privada RSA válida para RS256.

## Decisiones que tomé sobre la marcha

- **Qué decidí:** guardar un snapshot opcional de los metadatos visibles en `Alert`.
- **Qué otra opción había:** resolver etiqueta y unidad desde la regla o el paquete cada vez que se lee la bandeja.
- **Por qué elegí esta:** una alerta histórica no debe cambiar de significado cuando cambie la configuración. La migración es aditiva y conserva las filas existentes. Constitución §2 y §3.

- **Qué decidí:** representar `NO_EVALUABLE` en la bandeja existente mediante `motivoNoEvaluada`.
- **Qué otra opción había:** crear una tabla y una segunda bandeja de evaluaciones.
- **Por qué elegí esta:** la pantalla necesita una sola lectura consultable y el estado queda inequívoco sin duplicar contratos. Esta decisión reemplaza parcialmente ADR-0025 y quedó documentada en ADR-0026.

- **Qué decidí:** obtener el catálogo de `PaqueteRubro.alertRules` y conservar el paquete canónico como compatibilidad mientras se actualiza una fila global sembrada con la forma anterior.
- **Qué otra opción había:** fijar las claves y etiquetas en el servicio o en frontend.
- **Por qué elegí esta:** el paquete decide el vocabulario y la configuración por rubro. Constitución §4.

- **Qué decidí:** agregar el script `verificar` que compone comandos ya existentes.
- **Qué otra opción había:** declarar que se ejecutaron equivalentes aunque el comando exigido por el issue no existía.
- **Por qué elegí esta:** el criterio pedía ese comando literalmente; hacerlo ejecutable evita una afirmación no reproducible.

## Dónde el issue no alcanzaba

- No definía si valor y umbral podían tener unidades distintas. El modelo conserva dos campos separados y hoy toma la unidad declarada por la regla para ambos.
- No nombraba el endpoint del catálogo. Se eligió `GET /companies/:companyId/alert-rules/catalog`, junto al recurso que configura.
- No decía si los metadatos debían resolverse al leer o persistirse. Se eligió snapshot por trazabilidad histórica.

## Qué quedó afuera

- La pantalla de `Coste-AR/CosteAR-frontend#191`.
- Indicadores nuevos o cambios a la matemática del evaluador.
- Nuevos canales de notificación.
- Hacer pasar `test:db` sin las credenciales criptográficas locales requeridas; no se inventó ni se commiteó una clave.
