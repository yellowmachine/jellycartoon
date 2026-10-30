#!/usr/bin/env bash
# The VPS's Dokploy apps (Seilide, Langua, Librarian, Scholio) to Cloudflare R2, every night, by
# root's cron (deploy/vps-backup.cron), with the houses' copy (Dockerfile.backup, backup-r2.sh) on
# each app's network: its database, its Environment and its files, each encrypted with age, the
# last 7 nights kept (#320).
#
#   vps-backup.sh <name> <Dokploy app> <database service> [files]
#
# <Dokploy app> is its compose project (its folder in /etc/dokploy/compose); [files] is
# `s3:<service>:<bucket>` (a rustfs or MinIO of the app) or `volume:<service>:<path>` (the volume
# mounted there). The database is dumped by its own pg_dump, in its container: its version (a newer
# one's dump does not restore cleanly in an older Postgres), and no password. The S3 keys come from
# the app's container, and its Environment is the .env Dokploy writes next to its compose file;
# R2's, from /etc/vps-backup.env (only root reads it). How it went, well or not, goes to Seilide's
# /admin (BACKUP_REPORT_*). See «Copias del VPS» in nube/README.md.
set -euo pipefail

[[ $# -ge 3 ]] || {
	echo "Uso: $0 <nombre> <app de Dokploy> <servicio de la base de datos> [s3:<servicio>:<bucket> | volume:<servicio>:<ruta>]" >&2
	exit 1
}
name=$1 app=$2 db_service=$3 files=${4:-}
image=${BACKUP_IMAGE:-ghcr.io/yellowmachine/jellycartoon-backup:stable}
settings=${VPS_BACKUP_SETTINGS:-/etc/vps-backup.env}

# A variable of the settings, without sourcing them (docker's --env-file: no quotes).
setting() { sed -n "s/^$1=//p" "$settings" 2>/dev/null | tail -n 1; }

# Its text as a JSON string: no jq on the VPS, and the log has nothing but text.
json_string() {
	local s
	s=$(tr -d '\000-\010\013\014\016-\037')
	s=${s//\\/\\\\}
	s=${s//\"/\\\"}
	s=${s//$'\t'/\\t}
	s=${s//$'\r'/}
	s=${s//$'\n'/\\n}
	printf '"%s"' "$s"
}

# How it went, well or not, to Seilide's /admin (BACKUP_REPORT_URL and BACKUP_REPORT_TOKEN in the
# settings; without them, nothing): `report <exit status> <its output>`. A failed report is only
# logged: the copy is what matters.
report() {
	local url token ok=false headers
	url=$(setting BACKUP_REPORT_URL) token=$(setting BACKUP_REPORT_TOKEN)
	[[ -n $url && -n $token ]] || return 0
	[[ $1 == 0 ]] && ok=true
	# The token in a file, not on the command line (ps).
	headers=$(mktemp)
	chmod 600 "$headers"
	printf 'Authorization: Bearer %s\nContent-Type: application/json\n' "$token" >"$headers"
	printf '{"name":%s,"ok":%s,"log":%s}' "$(json_string <<<"$name")" "$ok" \
		"$(tail -n 40 "$2" | json_string)" |
		curl -fsS -m 20 -H @"$headers" --data-binary @- "$url" >/dev/null ||
		echo "$name: no se pudo avisar a $url" >&2
	rm -f "$headers"
}

# The copy in a process of its own, its output kept to report, whatever ends it (`exit 1` in it).
if [[ -z ${VPS_BACKUP_RUN:-} ]]; then
	out=$(mktemp)
	trap 'rm -f "$out"' EXIT
	set +e
	VPS_BACKUP_RUN=1 "$0" "$@" 2>&1 | tee "$out"
	status=${PIPESTATUS[0]}
	set -e
	report "$status" "$out"
	exit "$status"
fi

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

# Its compose file's folder, as compose labels it: Dokploy's .env is there (Seilide's, in nube/).
env_file=$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$db")/.env
[[ -f $env_file ]] || {
	echo "$name: no está su .env ($env_file)" >&2
	exit 1
}

# Only root reads what is here: the dump, and the keys in a file, not on the command line (ps).
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
chmod 700 "$work"
echo "BACKUP_NAME=$name" >"$work/vars"
# shellcheck disable=SC2016 # The container's own variables.
docker exec "$db" sh -c 'pg_dump -U "$POSTGRES_USER" -Fc "${POSTGRES_DB:-$POSTGRES_USER}"' >"$work/db.dump"

# As root inside: it reads the dump, and the app's files need not be readable by the image's user.
run=(docker run --rm --user 0:0 --network "$network" --env-file "$settings" --env-file "$work/vars"
	-v "$work/db.dump:/backup/db.dump:ro" -v "$env_file:/backup/env:ro")
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
