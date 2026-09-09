# 2026-09-08 — no publicar términos borrador en producción

- **Issue:** #281
- **Repo:** CosteAR-backend
- **Rama:** `fix/issue-281-terms-validation`
- **PR:** #283
- **Agente:** Codex · GPT-5
- **Tanda:** no informada

## Recursos

| | |
| --- | --- |
| Tiempo de la sesión | ~30 min |
| Tokens consumidos | no informado |
| Intentos hasta el verde | 3 (rojo deliberado, verde local y corrección de arranque E2E) |
| Comandos de verificación corridos | `npm.cmd run prisma:generate`, `npm.cmd test`, `npm.cmd run lint`, `npm.cmd run typecheck`, `npm.cmd run check:tests-base` |

## Qué se hizo

Se agregó una guarda de contenido antes de sembrar la versión inicial de Términos y Condiciones. En producción, los marcadores pendientes y la nota interna del borrador impiden crear la versión y abortan el arranque antes de escuchar tráfico. En desarrollo y test, el borrador se conserva para no bloquear el trabajo local, pero se registra un warning con cada marcador encontrado.

También se cubrió el caso de no poder leer el archivo: nunca termina en una siembra. Las fallas transitorias de base mantienen el modo degradado existente; no se confunden con un texto legal inválido.

## Decisiones que tomé sobre la marcha

- **Qué decidí:** usar `InvalidInitialTermsContentError` para distinguir contenido inválido de una falla transitoria en el arranque.
- **Qué otra opción había:** clasificar por el texto del mensaje o volver fatal cualquier excepción del sembrado.
- **Por qué elegí esta:** el tipo hace explícita la condición determinística y conserva el arranque degradado ante una base momentáneamente inaccesible.

- **Qué decidí:** inyectar en el servicio el lector del markdown y el ambiente solo para las pruebas.
- **Qué otra opción había:** mockear `node:fs/promises` globalmente.
- **Por qué elegí esta:** permite probar sabotaje de lectura y un markdown limpio sin ocultar la lectura del archivo real que cubre el flujo local.

- **Qué decidí:** conservar la ejecución incondicional de `main()` en el módulo de servidor y mockear sus dependencias en el test de arranque.
- **Qué otra opción había:** omitir el arranque cuando `VITEST=true`.
- **Por qué elegí esta:** la E2E hereda esa variable al proceso compilado que lanza; usarla como guard impedía que el servidor escuchara.

## Dónde el issue no alcanzaba

- El issue definía la nota interna como marcador pero no su texto estable. Se tomó como patrón la cabecera actual `Nota interna, no forma parte del contrato`, además de los marcadores entre corchetes solicitados.
- El comportamiento de desarrollo ante un archivo ilegible no estaba detallado. Se decidió no sembrar nunca sin contenido; el servidor de desarrollo conserva el modo degradado y deja el warning visible.

## Qué quedó afuera

- No se modificó `prisma/initial-terms.md`, el flujo de aceptación, el versionado ni los endpoints de administración, porque están explícitamente fuera de alcance.
- No se abrió un issue nuevo.

## Con qué se verifica

```bash
# Falla primero, antes de implementar la guarda:
npm.cmd test -- tests/application/terms-service.test.ts
# 1 test falló: la promesa resolvía en producción en vez de rechazar.

# Verde después de implementar:
npm.cmd test -- tests/application/terms-service.test.ts tests/infrastructure/terms-startup.test.ts tests/infrastructure/server-terms-startup.test.ts
# 3 archivos, 20 tests pasaron.

npm.cmd run prisma:generate
# pasó.
npm.cmd run lint
# pasó.
npm.cmd run typecheck
# pasó.
npm.cmd run check:tests-base
# pasó: todos los tests con base están declarados.
npm.cmd test
# 172 archivos pasaron, 1 omitido; 1557 tests pasaron, 4 omitidos.

docker compose ps
# no se pudo ejecutar la E2E local: el daemon de Docker no estaba disponible.
```
