---
issue: 384
repo: CosteAR-backend
pr: 397
rama: feat/384-superficies-modulos
agente: codex
modelo: gpt-5
tanda: B3
inicio: 2026-09-21T00:02:39-03:00
fin: 2026-09-21T00:15:45-03:00
minutos: 13
tokens: no-informado
clears: 0
intentos_hasta_verde: 3
rojos_deliberados: 1
rebotes_de_guarda: 0
---

# 2026-09-21 — Los módulos explican qué habilitan y qué datos van a pedir

## Qué se hizo

El GET de módulos ahora publica las capacidades estables de interfaz de cada módulo y describe
cada parámetro con su texto y, cuando corresponde, sus opciones. La información se devuelve
también para módulos apagados, de modo que la pantalla puede explicar qué va a pedir antes de
prenderlos. El PUT no cambió.

El endpoint quedó incorporado al contrato OpenAPI tipado. También se cubrió la transición para
filas de paquete sembradas antes de este cambio: la declaración canónica completa únicamente el
campo nuevo en memoria, sin reescribir el JSON existente ni el estado configurado por empresa.

Se abrió `Coste-AR/CosteAR-frontend#195` para consumir el contrato cuando #384 llegue a `dev`.

## Decisiones que tomé sobre la marcha

- **Qué decidí:** usar claves de capacidad con forma `área.capacidad` y una capacidad mínima por
  cada superficie existente (`carga.produccion-diaria`, `carga.bajas-plantel`,
  `tablero.variantes`, entre otras).
- **Qué otra opción había:** publicar las claves de módulo o de parámetro como si fueran
  capacidades, o inventar varias superficies futuras por módulo.
- **Por qué elegí esta:** el issue prohíbe el primer acoplamiento y no define superficies que aún
  no existan. Las claves elegidas describen capacidades actuales sin anticipar pantallas.

- **Qué decidí:** mantener el PUT con `parametros: string[]` y enriquecer sólo la proyección del
  GET.
- **Qué otra opción había:** cambiar la respuesta de ambas operaciones por comodidad interna.
- **Por qué elegí esta:** “sin cambios en el PUT” es un límite explícito del issue.

- **Qué decidí:** completar `superficies` desde el paquete canónico cuando una fila persistida
  tiene el JSON anterior.
- **Qué otra opción había:** depender de volver a ejecutar el seed o escribir una migración que
  actualizara datos existentes.
- **Por qué elegí esta:** los seeds no forman parte del deploy y una reescritura de datos no era
  necesaria. La compatibilidad de lectura mantiene la migración en cero y respeta Constitución
  §2: la ausencia no se reemplaza por una capacidad inventada.

## Dónde el issue no alcanzaba

El issue daba tres ejemplos de superficies pero no enumeraba el catálogo completo. Se adoptó una
clave literal y estable para cada capacidad ya descrita por los ocho módulos, sin agregar nuevas
pantallas ni comportamiento.

Tampoco decía cómo actualizar filas de `PaqueteRubro` ya sembradas. Se verificó que el deploy no
ejecuta `seedPaqueteAvicola`; por eso la compatibilidad se resolvió al leer, con una prueba para el
JSON anterior.

Antes de tomar #384, #380 resultó contradictorio con su plan canónico: la pregunta K figura como
bloqueante aunque el issue dice “sin bloqueos”. Se dejó una única pregunta en #380 y se aplicó
Constitución §9 antes de pasar al siguiente `listo` independiente.

## Qué quedó afuera

- Dibujar las superficies en frontend: seguimiento `Coste-AR/CosteAR-frontend#195`, dependiente de
  #384.
- Cambios al PUT, al motor y a la persistencia: el issue los excluye y no hacen falta para el
  contrato de lectura.
- Suites de integración y DB: no se tocaron queries, RLS, schema ni aislamiento.

## Con qué se verifica

```bash
npx vitest run tests/http/modulos-rubro.test.ts
# rojo previo real: 1 failed, 3 passed; faltaban superficies y descripciones

npx vitest run tests/http/modulos-rubro.test.ts tests/application/paquete-avicola.test.ts \
  tests/http/parametros-costeo.test.ts tests/application/parametros-costeo-service.test.ts
# 4 archivos, 37 tests verdes

npm run typecheck
# verde
npm run lint
# verde
npm test -- --maxWorkers=1
# 211 archivos verdes, 1 skipped; 1836 tests verdes, 4 skipped
npm run test:http -- --maxWorkers=1
# 25 archivos, 141 tests verdes
npm run check:tests-base
# verde
npm run check:openapi
# verde; 23 operaciones tipadas
npm run typecheck:openapi-consumer
# verde
git diff --check
# verde
```
