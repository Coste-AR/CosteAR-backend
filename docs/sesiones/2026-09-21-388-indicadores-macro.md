---
issue: 388
repo: CosteAR-backend
pr: 404
rama: feat/388-indicadores-macro
agente: codex
modelo: gpt-5
tanda: B3
inicio: 2026-09-21T12:03:00-03:00
fin: 2026-09-21T12:21:09-03:00
minutos: 18
tokens: no-informado
clears: 0
intentos_hasta_verde: 2
rojos_deliberados: 1
rebotes_de_guarda: 0
---

# 2026-09-21 — Los indicadores externos llegan con fecha y fuente navegable

## Qué se hizo

- Se publicó `GET /companies/:companyId/indicadores-macro`: entrega dólar oficial, inflación
  mensual y los indicadores adicionales que declara el paquete del rubro.
- El paquete avícola declara el dólar blue y las seis referencias CAPIA que ya consume el
  frontend: huevo blanco/color, alimento de ponedora, maíz, soja y maple.
- Cada indicador lleva valor, unidad, fecha real, nombre y URL de la fuente. Una lectura ausente
  conserva su lugar con `valor: null`, `fecha: null` y `error: 'fuente no disponible'`; las demás
  lecturas siguen disponibles.
- La operación se incorporó al contrato OpenAPI generado, que pasó de 23 a 24 operaciones.

## Decisiones que tomé sobre la marcha

- **Qué decidí:** leer el caché de `MacroSnapshot` que alimenta el worker diario.
  **Qué otra opción había:** volver a llamar BCRA, INDEC, DolarApi y CAPIA en cada GET, o crear
  otro caché. **Por qué elegí esta:** #350 ya fijó una única ingesta idempotente y conserva la
  fecha real de publicación; duplicarla podía desalinear valores y fuentes. Constitución §2:
  una falla no se rellena con cero ni con fecha de hoy.
- **Qué decidí:** dólar oficial e IPC son el núcleo común; el dólar alternativo y las
  referencias sectoriales viven en `screens.indicadoresMacro` del paquete. **Qué otra opción
  había:** condicionar por empresa/industria dentro del servicio. **Por qué elegí esta:** deja
  el contenido en `PaqueteRubro` y no introduce un `if` por cliente (Constitución §4).
- **Qué decidí:** reutilizar las seis claves CAPIA que ya estaban declaradas en
  `CapiaReferences.tsx` del frontend. **Qué otra opción había:** exponer los 21 productos de la
  encuesta o elegir otra selección. **Por qué elegí esta:** evita inventar una curaduría nueva y
  mueve al paquete el catálogo que hoy estaba hardcodeado en la interfaz (Constitución §9).
- **Qué decidí:** una fila vieja de paquete sin el campo nuevo recibe el catálogo canónico en
  lectura; un array explícito, incluso vacío, manda. **Qué otra opción había:** exigir resembrar
  antes de servir el endpoint. **Por qué elegí esta:** el despliegue no debe depender de una
  reescritura de configuración ya persistida.

## Dónde el issue no alcanzaba

- No decía qué cotización adicional correspondía al rubro avícola ni cuántas referencias CAPIA
  debían entrar. Se preservó el dólar blue ya integrado y el mismo conjunto de seis referencias
  que consumía el frontend.
- No definía si el GET debía consultar Internet o leer la corrida diaria. Se reutilizó la
  ingesta existente para que haya una sola fuente de verdad y para que una request no dependa de
  cuatro servicios externos.
- #350 ordena mostrar la última semana CAPIA guardada con su fecha cuando CAPIA falla. Por eso una
  lectura histórica real se sigue mostrando; `fuente no disponible` significa que el caché no
  tiene ninguna lectura para esa clave, no que se borra un dato publicado previamente.

## Qué quedó afuera

- Alertas sobre variables macro y KPIs internos del negocio.
- La pantalla del home; la implementa `Coste-AR/CosteAR-frontend#185` cuando este contrato entre.
- Cambios de schema o una segunda persistencia para CAPIA: no hacen falta para este contrato.

## Con qué se verifica

```bash
npm run lint
# verde
npm run typecheck
# verde
npm test -- --maxWorkers=1
# 214 archivos verdes, 1 skipped; 1.859 tests verdes, 4 skipped existentes
npm run test:http -- --maxWorkers=1
# 26 archivos; 143 tests verdes
npm run test:integration
# 26 archivos; 81 tests verdes con rol sin BYPASSRLS
npm run test:db
# 5 archivos; 66 tests verdes con sonda RLS y claves RSA efímeras
npm run check:tests-base
# verde
npm run check:openapi
# verde; 24 operaciones tipadas
```

Rojo deliberado: antes de registrar la ruta, los dos primeros casos del contrato respondieron
404. El caso negativo deja `USD_OFICIAL` ausente y comprueba que IPC y CAPIA conservan sus valores.
El primer `npm run test:db` llegó a 58 pruebas verdes y se frenó por la clave JWT placeholder;
se repitió con un par RSA efímero y terminó 66/66. El primer `db:setup` usó el rol restringido,
declaró el `42501` y se repitió con el dueño para aplicar 213 sentencias RLS.
