#!/bin/bash
# El rol de Electric y su publicación, al crear la base: modo manual de
# https://electric.ax/docs/sync/guides/postgres-permissions.
# Sin BYPASSRLS: ve solo lo que publicar.sql le da.
set -euo pipefail

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
	CREATE ROLE ${ELECTRIC_DB_USER} WITH LOGIN REPLICATION NOSUPERUSER NOBYPASSRLS PASSWORD '${ELECTRIC_DB_PASSWORD}';
	GRANT CONNECT ON DATABASE ${POSTGRES_DB} TO ${ELECTRIC_DB_USER};
	GRANT USAGE ON SCHEMA public TO ${ELECTRIC_DB_USER};
	CREATE PUBLICATION electric_publication_default;
	GRANT CREATE ON DATABASE ${POSTGRES_DB} TO ${ELECTRIC_DB_USER};
	ALTER PUBLICATION electric_publication_default OWNER TO ${ELECTRIC_DB_USER};
	REVOKE CREATE ON DATABASE ${POSTGRES_DB} FROM ${ELECTRIC_DB_USER};
EOSQL
