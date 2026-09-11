# 2026-09-10 — El seed avícola queda como vocabulario de rubro

- **Issue:** #329
- **Repo:** CosteAR-backend
- **Rama:** `fix/issue-329-seed-vocabulario-tenant`
- **PR:** #330
- **Agente:** Codex · GPT-5
- **Tanda:** B0

## Recursos

| | |
| --- | --- |
| Tiempo de la sesión | ~50 min |
| Tokens consumidos | no informado |
| Intentos hasta el verde | 5 para la prueba focal; uno adicional rojo, intencional, para probar la guarda |
| Comandos de verificación corridos | `npm ci --force`, `npm run prisma:generate`, `npm exec -- vitest run tests/config/seed-vocabulario-privacidad.test.ts`, `npm run lint`, `npm run typecheck`, `npm run test` |

> La primera instalación dejó el árbol de dependencias incompleto por un bloqueo de Windows sobre
> `@prisma/client`; se repuso desde el lockfile y se generó el cliente Prisma antes de correr las
> pruebas. No se modificó `package-lock.json`.

## Qué se hizo

- El seed queda con 61 términos de vocabulario avícola de rubro.
- Se generalizaron los siete términos que sí aportan al clasificador, retirando de sus descripciones
  cifras, comparaciones y contexto de una operación concreta.
- Se retiraron siete entradas que eran exclusivamente ubicaciones, canales, proveedores o negocios
  de un tenant. La lista de `externalId` retirados permite limpiarlas de instalaciones existentes.
- El seed borra esas filas por `externalId` antes de sus upserts, de modo que una reejecución no las
  conserva ni las resucita.
- La prueba de privacidad usa huellas normalizadas de los identificadores retirados, en vez de
  repetirlos en el repositorio público. El caso de reintroducción se ejecutó en rojo de forma
  deliberada y falló; con la aserción correcta queda verde.

## Decisiones que tomé sobre la marcha

- **Qué decidí:** generalizar `AV-003`, `AV-010`, `AV-013`, `AV-057`, `AV-059`, `AV-060` y `AV-066`.
- **Qué otra opción había:** retirar los catorce términos por completo.
- **Por qué elegí esta:** esos siete nombres describen conceptos reutilizables del rubro; lo que
  identificaba al tenant era la explicación concreta, no la keyword que el clasificador necesita.

- **Qué decidí:** retirar `AV-061`, `AV-062`, `AV-063`, `AV-064`, `AV-065`, `AV-067` y `AV-068`.
- **Qué otra opción había:** redactarlos como términos genéricos.
- **Por qué elegí esta:** no aportan un concepto avícola general; abstraerlos habría creado un
  término distinto y ocultado que la entrada original era específica de un tenant.

- **Qué decidí:** borrar también las filas heredadas desde el seed por `externalId`.
- **Qué otra opción había:** sacar las entradas solo del arreglo de upsert.
- **Por qué elegí esta:** solo quitar el código deja los datos ya sembrados disponibles; la limpieza
  debe alcanzar tanto una base nueva como una instalación que ejecutó el seed anterior.

## Dónde el issue no alcanzaba

- El issue exige que una reejecución no resucite lo retirado, pero no especifica cómo limpiar bases
  ya sembradas. Se asumió que la limpieza por `externalId` es segura porque esos IDs identifican
  exactamente las filas retiradas y el `deleteMany` es idempotente.
- El issue pide una guarda sin volver a publicar datos protegidos. Se eligieron huellas SHA-256 de
  valores normalizados; la alternativa de una lista literal habría repetido justamente la
  información que se está retirando.

## Qué quedó afuera

- No se implementó vocabulario por tenant: sigue fuera de alcance según #329.
- No se reescribió el historial de git, conforme al alcance explícito del issue.

## Con qué se verifica

```bash
npm exec -- vitest run tests/config/seed-vocabulario-privacidad.test.ts # 3 passed
npm run lint                                                            # passed
npm run typecheck                                                       # passed
npm run test                                                            # 182 archivos passed, 1 skipped; 1622 tests passed, 4 skipped
```
