# 0001 — Separar los tests en tres suites según el rol de Postgres que necesitan

- **Fecha:** 2026-08-15
- **Estado:** Aceptada
- **Decide:** Santiago
- **Contexto de origen:** revisión de pendientes del 15-08-2026, al descubrir que 61 tests no corrían en CI

## Contexto

El CI daba verde con **1.292 tests, de los cuales 65 se salteaban en silencio**. De esos, 61
**no corrían en ningún lado**: ni en la suite rápida ni en la de integración.

Los archivos afectados y por qué importa cada uno:

| Archivo | Tests | Qué verifica |
| --- | --- | --- |
| `tests/security/rls-cross-tenant.test.ts` | 34 | Que una empresa **no vea** los datos de otra |
| `tests/security/evidence-append-only.test.ts` | 9 | Que la evidencia sea append-only (regla dura R1) |
| `tests/validaciones/ledger-criterio-importe-iva.test.ts` | 10 | Criterio de importe e IVA del backfill |
| `tests/application/trazabilidad-ordenes-config.test.ts` | 5 | Árbol de cálculo trazable |
| `tests/application/trazabilidad-procedencia-ia.test.ts` | 3 | Procedencia de la clasificación IA |

**Cómo se produjo el hueco.** La convención era "lo que necesita base vive en
`tests/integration/`". Estos cinco archivos quedaron fuera de esa carpeta y se juntaron tres
cosas, cada una razonable por separado:

1. Los archivos se auto-saltean si no hay `DATABASE_URL` — correcto: no deben reventar en la
   máquina de alguien que no levantó Docker.
2. La suite rápida no tiene `DATABASE_URL` — correcto: corre con Prisma mockeado.
3. `vitest.integration.config.ts` incluía solo `tests/integration/**` — y ahí no matcheaban.

Nadie los corría, y como *saltearse* no es *fallar*, el CI seguía en verde.

**Además, al intentar incluirlos apareció un segundo problema.** Con `DATABASE_URL` apuntando al
rol de la aplicación (sin `BYPASSRLS`, como corresponde en el job de integración), estos archivos
**ni siquiera pueden sembrar sus fixtures**: insertan con SQL crudo y RLS los rechaza con
`42501: new row violates row-level security policy`. Están escritos asumiendo el rol dueño.

O sea: los dos grupos necesitan roles **opuestos**.

## Decisión

Tres suites, cada una con el rol que le corresponde, y una sola lista compartida que define
quién va dónde (`tests/db-dependent.mjs`):

| Suite | Config | Rol de Postgres | Qué corre |
| --- | --- | --- | --- |
| Rápida | `vitest.config.ts` | ninguno (Prisma mockeado) | Todo lo demás |
| Integración | `vitest.integration.config.ts` | **aplicación**, sin `BYPASSRLS` | `tests/integration/**` |
| Con base | `vitest.db.config.ts` | **dueño** + sonda restringida | Los 5 archivos de arriba |

En `rls-cross-tenant` la distinción es el corazón del test: **siembra con el dueño y verifica con
`RLS_PROBE_DATABASE_URL`**, que apunta a un rol sin `BYPASSRLS`. El CI corre esa suite con
`RLS_REQUIRE_PROBE=1`, que hace que el archivo **falle en vez de saltearse** si la sonda no está.

Se agrega `scripts/check-tests-con-base.mjs`, que corre en CI y falla si aparece un test que lee
`DATABASE_URL` y no está en ninguna lista.

## Alternativas consideradas

| Alternativa | Por qué no |
| --- | --- |
| Mover los 5 archivos a `tests/integration/` | No alcanza: el problema del rol seguiría igual. Y `tests/security/` y `tests/validaciones/` describen mejor qué hace cada uno |
| Darle `DATABASE_URL` a la suite rápida | Rompe su razón de ser: 1.222 tests que hoy corren en segundos pasarían a necesitar Docker en la máquina de cada uno |
| Reescribir los tests para que siembren con el rol de la app | Habría que darle permisos de escritura amplios al rol restringido, debilitando justo lo que `rls-cross-tenant` verifica. Además toca 5 archivos críticos para el cliente |
| Una sola suite de base con el rol dueño | `tests/integration/**` **tiene** que correr sin `BYPASSRLS`: con el dueño daría verde aunque las políticas RLS estuvieran rotas |

## Consecuencias

**A favor**

- 61 tests que no corrían pasan a correr, entre ellos los 34 del aislamiento entre empresas
- El aislamiento se verifica contra un rol real que no saltea RLS, y **falla** si no se puede verificar
- La lista compartida impide que la suite rápida y las de base se desalineen
- La guarda en CI evita que el bug vuelva a aparecer

**En contra / lo que aceptamos pagar**

- Tres configs de vitest en vez de dos: más superficie para entender al entrar al repo
- El job de integración del CI tarda más (dos tandas en vez de una)
- Hay que acordarse de agregar los tests nuevos a `tests/db-dependent.mjs` — mitigado por la guarda,
  que lo dice con el mensaje exacto de qué hacer

**Qué se rompe si alguien la revierte sin leer esto**

- Volver a unificar los configs deja `tests/integration/**` corriendo con el rol dueño, y ahí
  **el aislamiento entre empresas pasa a dar verde aunque RLS esté roto**. Es el modo de falla
  más caro posible: el test existe, está en verde, y no prueba nada.

## Cómo se verifica que sigue vigente

```bash
npm run check:tests-base    # falla si un test con base quedó fuera de las listas
```

Y en el log del CI, el paso *"Run DB-backed security & traceability tests"* tiene que reportar
**66 tests pasando, 0 salteados**. Si aparecen salteados ahí, la sonda de RLS no está llegando.
