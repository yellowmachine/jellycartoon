#!/usr/bin/env bash
# The VPS's other Dokploy apps (Langua, Librarian, Scholio) to Cloudflare R2, every night, by root's
# cron (deploy/vps-backup.cron), with the houses' copy (Dockerfile.backup, backup-r2.sh) on each
# app's network: its database, its Environment and its files, each encrypted with age, the last 7
# nights kept (#320). Seilide copies itself (nube/compose.prod.yaml, `backup` profile).
#
#   vps-backup.sh <name> <Dokploy app> <database service> [files]
#
# <Dokploy app> is its folder in /etc/dokploy/compose and its compose project; [files] is
# `s3:<service>:<bucket>` (a rustfs or MinIO of the app) or `volume:<service>:<path>` (the volume
# mounted there). The database is dumped by its own pg_dump, in its container: its version (a newer
# one's dump does not restore cleanly in an older Postgres), and no password. The S3 keys come from
# the app's container; R2's, from /etc/vps-backup.env (only root reads it). See «Copias de las otras
# apps del VPS» in nube/README.md.
set -euo pipefail

[[ $# -ge 3 ]] || {
	echo "Uso: $0 <nombre> <app de Dokploy> <servicio de la base de datos> [s3:<servicio>:<bucket> | volume:<servicio>:<ruta>]" >&2
	exit 1
}
name=$1 app=$2 db_service=$3 files=${4:-}
image=${BACKUP_IMAGE:-ghcr.io/yellowmachine/jellycartoon-backup:stable}
settings=${VPS_BACKUP_SETTINGS:-/etc/vps-backup.env}
compose_dir=${DOKPLOY_COMPOSE_DIR:-/etc/dokploy/compose}

# A running container of the app's service.
container() {
	local id
	id=$(docker ps -q --filter "label=com.docker.compose.project=$app" \
		--filter "label=com.docker.compose.service=$1" | head -n 1)
	[[ -n $id ]] || {
		echo "$name: no está en marcha el servicio $1 de $app" >&2
		exit 1
	}
	echo "$id"
}
# A variable of a container's environment.
env_of() { docker exec "$1" printenv "$2"; }

db=$(container "$db_service")
# The app's own network, where its services answer by their names (not Dokploy's, shared by all).
network=$(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{println $k}}{{end}}' "$db" |
	grep -vx -e dokploy-network -e '' | head -n 1)

# Only root reads what is here: the dump, and the keys in a file, not on the command line (ps).
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
chmod 700 "$work"
echo "BACKUP_NAME=$name" >"$work/vars"
# shellcheck disable=SC2016 # The container's own variables.
docker exec "$db" sh -c 'pg_dump -U "$POSTGRES_USER" -Fc "${POSTGRES_DB:-$POSTGRES_USER}"' >"$work/db.dump"

# As root inside: it reads the dump, and the app's files need not be readable by the image's user.
run=(docker run --rm --user 0:0 --network "$network" --env-file "$settings" --env-file "$work/vars"
	-v "$work/db.dump:/backup/db.dump:ro" -v "$compose_dir/$app/code/.env:/backup/env:ro")
case $files in
s3:*:*)
	IFS=: read -r _ service bucket <<<"$files"
	s3=$(container "$service")
	{
		echo "FILES_S3_ENDPOINT=http://$service:9000"
		echo "FILES_S3_BUCKET=$bucket"
		echo "FILES_S3_ACCESS_KEY_ID=$(env_of "$s3" RUSTFS_ACCESS_KEY)"
		echo "FILES_S3_SECRET_ACCESS_KEY=$(env_of "$s3" RUSTFS_SECRET_KEY)"
	} >>"$work/vars"
	;;
volume:*:*)
	IFS=: read -r _ service path <<<"$files"
	volume=$(docker inspect -f "{{range .Mounts}}{{if eq .Destination \"$path\"}}{{.Name}}{{end}}{{end}}" \
		"$(container "$service")")
	[[ -n $volume ]] || {
		echo "$name: no hay un volumen en $path de $service" >&2
		exit 1
	}
	run+=(-v "$volume:/backup/files:ro")
	;;
'') ;;
*)
	echo "$name: ficheros no válidos: $files" >&2
	exit 1
	;;
esac

# The latest of its tag; without the registry, the one already here.
docker pull -q "$image" >/dev/null || echo "$name: no se pudo bajar $image; con la que hay" >&2
"${run[@]}" "$image" now
