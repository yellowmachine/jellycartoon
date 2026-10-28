#!/bin/bash
# The app's role, once, when the database is made (Postgres' /docker-entrypoint-initdb.d in
# compose.yaml; by hand in production, see the README). Not the tables' owner, who makes them in the
# migrations (MIGRATE_DATABASE_URL): so row-level security applies to the app (family.schema.ts).
set -euo pipefail

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
	CREATE ROLE ${APP_DB_USER} WITH LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${APP_DB_PASSWORD}';
	GRANT CONNECT ON DATABASE ${POSTGRES_DB} TO ${APP_DB_USER};
	GRANT USAGE ON SCHEMA public TO ${APP_DB_USER};
	-- What the owner makes from now on (the migrations), the app may use: rows, not tables.
	ALTER DEFAULT PRIVILEGES FOR ROLE ${POSTGRES_USER} IN SCHEMA public
		GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${APP_DB_USER};
	ALTER DEFAULT PRIVILEGES FOR ROLE ${POSTGRES_USER} IN SCHEMA public
		GRANT USAGE, SELECT ON SEQUENCES TO ${APP_DB_USER};
EOSQL
