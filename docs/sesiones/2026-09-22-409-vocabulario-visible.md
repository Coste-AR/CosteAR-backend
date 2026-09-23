---
issue: 409
repo: CosteAR-backend
pr: 415
rama: fix/vocabulario-visible-409
agente: codex
modelo: gpt-5
tanda: B3
inicio: 2026-09-22T22:23-03:00
fin: 2026-09-22T22:42-03:00
minutos: 19
tokens: no-informado
clears: 0
intentos_hasta_verde: 5
rojos_deliberados: 1
rebotes_de_guarda: 1
---

# 2026-09-22 — CosteAR habla de negocios y personas

## Qué se hizo

- Se reescribió el correo de invitación para que no use el rol heredado ni «empresa» en su texto visible.
- El catálogo de parámetros y comportamientos ahora habla de cada negocio y de decisiones de la persona.
- El asesor y los otros prompts que pueden producir texto visible usan «negocio» y «persona».
- El barrido adicional corrigió mensajes de error y estados visibles sin modificar rutas, enums ni valores técnicos de trazabilidad.
- Se agregaron pruebas sobre el HTML final del correo, los campos expuestos de los catálogos y los cuatro prompts del asesor.

## Decisiones que tomé sobre la marcha

- **Qué decidí:** conservar `EMPRESA_ADMIN`, `COSTISTA_CHAT`, rutas, nombres de campos, áreas de trazabilidad y `origen: "empresa"`.
- **Qué otra opción había:** renombrar también esos identificadores y valores persistidos.
- **Por qué elegí esta:** el issue los declara fuera de alcance y cambiar contratos rompería consumidores y trazabilidad. Constitución §1 y §4: el texto visible se dirige al dueño y el vocabulario no se resuelve con excepciones por cliente.

- **Qué decidí:** extender el cambio a mensajes y prompts observables hallados por el barrido, además de las tres ubicaciones enumeradas.
- **Qué otra opción había:** corregir sólo correo, catálogo y asesor.
- **Por qué elegí esta:** el criterio pide auditar la salida completa; dejar errores o respuestas generadas con el vocabulario anterior incumplía el mismo contrato visible.

## Dónde el issue no alcanzaba

- No definía la frase exacta para reemplazar el rol heredado. Se usó «vos», «la persona» o «quien administra el negocio» según el contexto, siguiendo los reemplazos de referencia de frontend#187.
- No distinguía prompts internos cuyo resultado llega a una persona de procesos puramente técnicos. Se corrigieron los prompts con capacidad de generar texto visible y se conservaron las claves técnicas que sólo enrutan o auditan.

## Qué quedó afuera

- Renombrar identificadores, archivos, rutas, enums, roles y valores históricos o persistidos.
- Reescribir comentarios internos y nombres de tests que describen el dominio técnico.
- Cambiar nombres de negocios cargados por usuarios, incluso si contienen una palabra prohibida.

## Con qué se verifica

```bash
npm run lint       # verde
npm run typecheck  # verde
npm run test       # 221 archivos pasados, 1 omitido; 1896 tests pasados, 4 omitidos
npm run test:http  # 30 archivos y 164 tests pasados
npm run test:integration  # 28 archivos y 86 tests pasados
```

El rojo deliberado ejecutó los cuatro tests nuevos antes del cambio: fallaron en correo, catálogo de parámetros, catálogo de comportamientos y prompt del asesor. Una ejecución paralela posterior produjo timeouts por competencia entre dos suites Vitest; la repetición secuencial completa pasó sin saltear pruebas. El primer CI de integración encontró nueve aserciones que todavía exigían el texto anterior; se actualizaron sin renombrar tests y la suite de integración local completa quedó verde.
