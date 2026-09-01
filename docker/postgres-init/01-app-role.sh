#!/bin/bash
# Crea el rol con el que corre la aplicación: sin superusuario ni BYPASSRLS.
#
# Docker ejecuta este directorio solo con un volumen de datos vacío. Para una
# base local que ya existe, se puede aplicar otra vez con:
#   docker compose exec postgres bash /docker-entrypoint-initdb.d/01-app-role.sh
set -euo pipefail

APP_ROLE="${APP_DB_ROLE:-costear_app}"
APP_PASSWORD="${APP_DB_PASSWORD:-costear_app}"

psql -v ON_ERROR_STOP=1 \
     --username "$POSTGRES_USER" \
     --dbname "$POSTGRES_DB" \
     -v app_role="$APP_ROLE" \
     -v app_password="$APP_PASSWORD" \
     -v db_name="$POSTGRES_DB" \
     -v owner_role="$POSTGRES_USER" <<-'EOSQL'
	-- Idempotente: solo crea el rol si todavía no existe.
	SELECT format('CREATE ROLE %I LOGIN PASSWORD %s NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE',
	              :'app_role', quote_literal(:'app_password'))
	WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_role')
	\gexec

	GRANT CONNECT ON DATABASE :"db_name" TO :"app_role";
	GRANT USAGE ON SCHEMA public TO :"app_role";

	-- Las migraciones se ejecutan después de este script: los permisos por
	-- defecto alcanzan también a sus tablas y secuencias futuras.
	ALTER DEFAULT PRIVILEGES FOR ROLE :"owner_role" IN SCHEMA public
	  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"app_role";
	ALTER DEFAULT PRIVILEGES FOR ROLE :"owner_role" IN SCHEMA public
	  GRANT USAGE, SELECT ON SEQUENCES TO :"app_role";

	-- También permite aplicar el script manualmente sobre una base ya creada.
	GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO :"app_role";
	GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO :"app_role";
EOSQL

echo "Rol de aplicación '$APP_ROLE' listo (NOSUPERUSER, NOBYPASSRLS)."
