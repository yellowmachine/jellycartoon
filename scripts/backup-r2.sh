#!/usr/bin/env bash
# The database, every night, to a Cloudflare R2 bucket (compose.prod.yaml, `backup` profile; image
# Dockerfile.backup). The dump is encrypted with age (https://age-encryption.org) before it leaves
# the machine: the server has only the public key, and the private one, to restore, is kept apart.
#
#   backup-r2.sh          waits for BACKUP_TIME every day (the service)
#   backup-r2.sh now      one copy now, e.g. `docker compose -f compose.prod.yaml run --rm backup now`
#
# Old copies are deleted by a lifecycle rule of the bucket, not from here: the R2 token only needs
# to write. See «Copia en Cloudflare R2» in the README.
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
export RCLONE_CONFIG_R2_ENDPOINT=https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com
export RCLONE_CONFIG_R2_NO_CHECK_BUCKET=true
export RCLONE_CONFIG_R2_NO_HEAD=true
export RCLONE_CONFIG_R2_ACL=private

# What the healthcheck looks at: the time of the last copy that went up.
ok=/tmp/last-backup-ok

backup() {
	local dir name
	dir=$(mktemp -d)
	# In UTC, like the copies before an update: they sort by name.
	name=jellycartoon-$(date -u +%Y%m%dT%H%MZ).dump.age
	log "Copia de la base de datos → r2:$R2_BUCKET/$name"
	(
		umask 077
		pg_dump -Fc >"$dir/db.dump"
		age -r "$BACKUP_AGE_RECIPIENT" -o "$dir/$name" "$dir/db.dump"
	)
	rclone copyto "$dir/$name" "r2:$R2_BUCKET/$name"
	rm -rf "$dir"
	touch "$ok"
	log "Subida ($name)"
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
	# A failed night is logged and tried again the next: the service does not stop.
	backup || log "La copia ha fallado; se intentará mañana"
done
