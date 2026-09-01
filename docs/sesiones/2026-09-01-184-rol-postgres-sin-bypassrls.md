# 2026-09-01 — Rol local de Postgres sin BYPASSRLS

- **Issue:** #184
- **Repo:** CosteAR-backend
- **Rama:** `codex/issue-184-app-role`
- **PR:** pendiente
- **Agente:** Codex
- **Tanda:** B1

## Recursos

| | |
| --- | --- |
| Intentos hasta el verde | 2 para `npm ci`; el primero dejó `node_modules` bloqueado y el segundo completó con `--force` |
| Comandos de verificación corridos | `bash -n`, `docker compose config --quiet`, consulta a `pg_roles`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:integration` |

## Qué se hizo

Se agregó el init script de Postgres que crea un rol de aplicación local con `NOSUPERUSER` y
`NOBYPASSRLS`. El compose lo monta en `/docker-entrypoint-initdb.d` y el archivo de entorno
distingue la URL del dueño para migraciones de la URL del rol de aplicación para la app y la
suite de integración.

El caso negativo ya existía en `tests/integration/aislamiento-entre-empresas.test.ts`: crea dos
empresas y verifica que una no puede leer datos de la otra. No se duplicó. La misma suite también
verifica que el rol de conexión no sea superusuario ni tenga `BYPASSRLS`.

## Decisiones que tomé sobre la marcha

- **Qué decidí:** Reutilizar el diseño del script local no publicado que el issue señalaba.
- **Qué otra opción había:** Escribir un script nuevo o cambiar el workflow de CI.
- **Por qué elegí esta:** No había un commit con ese archivo en ninguna rama, pero sí una copia
  local sin publicar en otra copia de trabajo, tal como anticipaba el issue. Su diseño coincide
  con CI: dueño para migraciones y rol restringido para aplicación. No se tocó CI.

- **Qué decidí:** Usar permisos por defecto del dueño, más grants para tablas existentes.
- **Qué otra opción había:** Dar privilegios tabla por tabla después de cada migración.
- **Por qué elegí esta:** El init corre antes de las migraciones; los default privileges hacen que
  las tablas y secuencias futuras nazcan accesibles al rol de aplicación sin debilitar sus
  atributos de RLS.

## Dónde el issue no alcanzaba

- `docker-compose.yml` usa el nombre fijo `costear-postgres`. Había un contenedor detenido de
  otra copia de trabajo con ese nombre y volumen propio. Para no borrarlo, se levantó el mismo
  servicio de esta rama con `docker compose run --service-ports --name costear-postgres-issue-184
  postgres`, que creó un volumen nuevo y ejecutó el init script. La diferencia solo evita la
  colisión local; la configuración y las variables verificadas son las del compose.
- El init de Docker solo corre automáticamente con el volumen vacío. El script documenta el
  comando idempotente para aplicarlo manualmente en una base local existente.

## Qué quedó afuera

- No se cambiaron policies de RLS, `prisma/schema.prisma`, producción ni CI.
- No se agregaron tests de aislamiento duplicados: los nueve existentes ejercitan el caso
  negativo contra Postgres real.
- No se alteró el contenedor ni el volumen de la otra copia de trabajo.

## Con qué se verificó

```bash
bash -n docker/postgres-init/01-app-role.sh
docker compose config --quiet
# ambos sin errores

docker exec costear-postgres-issue-184 psql -U costear -d costear -c \
  "SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'costear_app';"
# rolname      | rolsuper | rolbypassrls
# costear_app  | f        | f

npm run lint && npm run typecheck
# sin errores

npm test
# completó sin fallos

npm run test:integration
# 1 archivo, 9 tests en verde (incluye aislamiento entre empresas)
```
