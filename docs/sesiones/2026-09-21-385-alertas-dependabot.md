---
issue: 385
repo: CosteAR-backend
pr: 398
rama: feat/385-alertas-dependabot
agente: codex
modelo: gpt-5
tanda: B3
inicio: 2026-09-21T04:02:23-03:00
fin: 2026-09-21T04:19:31-03:00
minutos: 17
tokens: no-informado
clears: 0
intentos_hasta_verde: 2
rojos_deliberados: 2
rebotes_de_guarda: 0
---

# 2026-09-21 — Se cerraron tres dependencias vulnerables

## Qué se hizo

- Se fijó `deepmerge-ts` 8.0.0 para la copia transitiva de `@prisma/config`.
- Se fijó `uuid` 11.1.1 para la copia transitiva de `exceljs`; la dependencia directa ya estaba
  parcheada en 14.0.0 y no se modificó.
- Se fijó `esbuild` 0.28.1 para la copia transitiva de `tsx` y se actualizó su permiso de script de
  instalación.
- Se conservaron los tres cambios en commits separados y no se actualizó ninguna otra dependencia.

## Decisiones que tomé sobre la marcha

- **Qué decidí:** usar overrides dirigidos al padre que incorpora cada copia vulnerable.
  **Qué otra opción había:** subir Prisma, ExcelJS y tsx completos o declarar nuevas dependencias
  directas. **Por qué elegí esta:** el issue prohíbe tocar otras dependencias y pide la primera
  versión parcheada de cada paquete afectado.
- **Qué decidí:** mantener `uuid` directo en 14.0.0 y actualizar sólo la copia de ExcelJS desde
  8.3.2 a 11.1.1. **Qué otra opción había:** forzar 14.0.0 también dentro de ExcelJS. **Por qué
  elegí esta:** 11.1.1 es el primer parche compatible con CommonJS indicado por el advisory y
  minimiza el salto de API.
- **Qué decidí:** actualizar `allowScripts` de esbuild junto con su bump. **Qué otra opción había:**
  dejar la clave 0.28.0 obsoleta. **Por qué elegí esta:** una instalación limpia debe permitir el
  binario de la versión efectiva, sin ampliar permisos a paquetes distintos.

## Dónde el issue no alcanzaba

- No explicitaba que las tres alertas correspondían a copias transitivas ni que el `uuid` directo
  ya estaba en una versión segura.
- El criterio que consulta Dependabot se mide sobre `dev`: seguirá mostrando las alertas hasta que
  el PR llegue a esa rama. En la rama se verificó la resolución efectiva y `npm audit` ya no lista
  ninguno de los tres paquetes.
- Este worktree no tenía `.env` y los contenedores saludables pertenecían al compose compartido. Se
  reutilizaron esos servicios con variables locales, sin recrearlos ni borrar datos.

## Qué quedó afuera

- `qs` conserva una alerta moderate de `npm audit`; no era una de las tres alertas de #385 y tocarla
  habría violado el límite de alcance.
- No se modificaron fixtures numéricos, código del motor ni tests.

## Con qué se verifica

```bash
npm ci
# 652 paquetes instalados; lock sin cambios; oxide-wasm32-wasi ausente

npm run prisma:generate
npm run lint
npm run typecheck
# verdes

npm run test -- --maxWorkers=1
# 1.836 verdes; 4 skipped existentes

npm run test:http
# 141 verdes

npm run test:integration
# 81 verdes, con costear_app sin BYPASSRLS

npm run test:db
# 66 verdes, con RLS_REQUIRE_PROBE=1

npm run check:tests-base
npm run check:openapi
npm run typecheck:openapi-consumer
# verdes

npm audit --json
# las tres vulnerabilidades objetivo ausentes; sólo qs moderate fuera de alcance
```

La primera suite general con dos workers tuvo un único timeout en
`owner-dashboard.test.ts`; el archivo pasó 12/12 aislado y la suite completa pasó con un worker,
sin cambiar límites ni tests. Los dos caminos negativos deliberados fueron un grafo circular para
`deepmerge-ts` y un buffer corto para `uuid`.
