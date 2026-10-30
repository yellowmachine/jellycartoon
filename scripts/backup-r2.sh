#!/usr/bin/env bash
# The database, every night, to a Cloudflare R2 bucket (compose.prod.yaml, `backup` profile; image
# Dockerfile.backup). The dump is encrypted with age (https://age-encryption.org) before it leaves
# the machine: the server has only the public key, and the private one, to restore, is kept apart.
# With it, if there are (#320): the .env mounted at /backup/env, and the files of an S3 bucket
# (Seilide's rustfs, FILES_S3_*) or of a folder mounted at /backup/files (a volume), each encrypted
# the same way. Seilide's is nube/compose.prod.yaml; the VPS's other apps', deploy/vps-backup.sh.
#
#   backup-r2.sh          waits for BACKUP_TIME every day (the service)
#   backup-r2.sh now      one copy now, e.g. `docker compose -f compose.prod.yaml run --rm backup now`
#
# Only the last BACKUP_KEEP nights stay (7), the older ones deleted after each copy: by number, not
# by age, so that copies that stop going up do not take the last good ones with them. See «Copia en
# Cloudflare R2» in the README.
set -euo pipefail

log() { echo "[$(date '+%F %T')] $*"; }

for name in R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET BACKUP_AGE_RECIPIENT; do
	if [[ -z ${!name:-} ]]; then
		log "Falta $name en el .env: sin ella no se puede subir la copia"
		exit 1
	fi
done

# rclone's remote `r2:` from the environment (https://rclone.org/docs/#config-file), as Cloudflare
# documents it for R2 (https://developers.cloudflare.com/r2/examples/rclone/). A token limited to
# one bucket cannot check that it exists, hence no_check_bucket. no_head: after uploading, rclone
# asks for the file by its version (`HEAD …?versionId=`), which R2 answers with 501 Not Implemented;
# the upload already carries its MD5, which R2 checks.
# No config file: everything comes from here, and rclone does not warn that it is missing.
export RCLONE_CONFIG=/dev/null
export RCLONE_CONFIG_R2_TYPE=${RCLONE_CONFIG_R2_TYPE:-s3}
export RCLONE_CONFIG_R2_PROVIDER=Cloudflare
export RCLONE_CONFIG_R2_ACCESS_KEY_ID=$R2_ACCESS_KEY_ID
export RCLONE_CONFIG_R2_SECRET_ACCESS_KEY=$R2_SECRET_ACCESS_KEY
# R2_ENDPOINT for a bucket with a jurisdiction (the EU's: https://<id>.eu.r2.cloudflarestorage.com).
export RCLONE_CONFIG_R2_ENDPOINT=${R2_ENDPOINT:-https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com}
export RCLONE_CONFIG_R2_NO_CHECK_BUCKET=true
export RCLONE_CONFIG_R2_NO_HEAD=true
export RCLONE_CONFIG_R2_ACL=private

# The bucket whose files go too (Seilide's rustfs), as the remote `files:`.
if [[ -n ${FILES_S3_ENDPOINT:-} ]]; then
	export RCLONE_CONFIG_FILES_TYPE=s3
	export RCLONE_CONFIG_FILES_PROVIDER=Other
	export RCLONE_CONFIG_FILES_ENDPOINT=$FILES_S3_ENDPOINT
	export RCLONE_CONFIG_FILES_ACCESS_KEY_ID=${FILES_S3_ACCESS_KEY_ID:?}
	export RCLONE_CONFIG_FILES_SECRET_ACCESS_KEY=${FILES_S3_SECRET_ACCESS_KEY:?}
	export RCLONE_CONFIG_FILES_FORCE_PATH_STYLE=true
fi

# Each copy's name starts so: `jellycartoon` at home, `seilide` in the cloud.
name_start=${BACKUP_NAME:-jellycartoon}

# What the healthcheck looks at: the time of the last copy that went up.
ok=/tmp/last-backup-ok

# Encrypted here, then up: `up <file> <name>`.
up() {
	(umask 077 && age -r "$BACKUP_AGE_RECIPIENT" -o "$dir/$2" "$1")
	rclone copyto "$dir/$2" "r2:$R2_BUCKET/$2"
	log "Subida $2"
}

backup() {
	local stamp
	dir=$(mktemp -d)
	# Whatever goes wrong, nothing left here in the clear.
	trap 'rm -rf "$dir"' EXIT
	# In UTC, like the copies before an update: they sort by name. One stamp for all of a night.
	stamp=$(date -u +%Y%m%dT%H%MZ)
	log "Copia → r2:$R2_BUCKET/$name_start-$stamp.*"
	# One made already by the database's own pg_dump (deploy/vps-backup.sh: its version, whatever
	# it is), or here.
	if [[ -f /backup/db.dump ]]; then
		up /backup/db.dump "$name_start-$stamp.dump.age"
	else
		(umask 077 && pg_dump -Fc >"$dir/db.dump")
		up "$dir/db.dump" "$name_start-$stamp.dump.age"
	fi
	# Its secrets: without them, the database cannot be read by a new install (BETTER_AUTH_SECRET).
	if [[ -f /backup/env ]]; then
		(umask 077 && cp /backup/env "$dir/env")
		up "$dir/env" "$name_start-$stamp.env.age"
	fi
	# All the files, again each night: simple, while they are few (photos and receipts).
	if [[ -n ${FILES_S3_ENDPOINT:-} ]]; then
		(umask 077 && mkdir "$dir/files" && rclone copy "files:${FILES_S3_BUCKET:?}" "$dir/files")
		(umask 077 && tar -C "$dir" -cf "$dir/files.tar" files)
		up "$dir/files.tar" "$name_start-$stamp.files.tar.age"
	elif [[ -d /backup/files ]]; then
		(umask 077 && tar -C /backup -cf "$dir/files.tar" files)
		up "$dir/files.tar" "$name_start-$stamp.files.tar.age"
	fi
	touch "$ok"
	prune || log "No se pudieron borrar las copias viejas; se intentará mañana"
}

# The nights before the last BACKUP_KEEP, gone: all the files of each. A failure is only logged (the
# copy did go up), and they go the next night.
prune() {
	local keep=${BACKUP_KEEP:-7} old
	old=$(rclone lsf --files-only "r2:$R2_BUCKET" |
		sed -nE "s/^$name_start-([0-9]{8}T[0-9]{4}Z)\..*/\1/p" | sort -u | head -n "-$keep")
	for stamp in $old; do
		rclone lsf --files-only --include "$name_start-$stamp.*" "r2:$R2_BUCKET" |
			while read -r file; do
				rclone deletefile "r2:$R2_BUCKET/$file" && log "Borrada $file" ||
					log "No se pudo borrar $file; se intentará mañana"
			done
	done
}

if [[ ${1:-} == now ]]; then
	backup
	exit
fi

# Healthy from the start; unhealthy only if a night's copy does not go up.
touch "$ok"
time=${BACKUP_TIME:-03:30}
log "Copia diaria a las $time (TZ=${TZ:-UTC}) en r2:$R2_BUCKET"
while true; do
	sleep $(($(date -d "$time" +%s) > $(date +%s) ? $(date -d "$time" +%s) - $(date +%s) : $(date -d "tomorrow $time" +%s) - $(date +%s)))
	# A failed night is logged and tried again the next: the service does not stop. In a process
	# of its own: in a function called with `||`, bash ignores `set -e`, and a failed pg_dump would
	# go on to upload an empty copy as a good one.
	"$0" now || log "La copia ha fallado; se intentará mañana"
done
