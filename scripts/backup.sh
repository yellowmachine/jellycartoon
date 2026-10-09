#!/usr/bin/env bash
# Backs up a production install (compose.prod.yaml) into a folder:
#
#   scripts/backup.sh /ruta/del/backup            # base de datos, DATA_DIR y .env
#   scripts/backup.sh --media /ruta/del/backup    # además, los originales (MEDIA_DIR)
#
# Run it from the folder with compose.prod.yaml and .env (or set COMPOSE_FILE). The database
# goes first: an episode converted while copying is at worst converted again after a restore,
# never marked as ready without its files. See "Copia de seguridad" in the README.
set -euo pipefail

usage() {
	echo "Uso: $0 [--media] <carpeta de destino>" >&2
	exit 1
}

media=false
if [[ ${1:-} == --media ]]; then
	media=true
	shift
fi
[[ $# -eq 1 ]] || usage
dest=$1

compose_file=${COMPOSE_FILE:-compose.prod.yaml}
compose=(docker compose -f "$compose_file")
command -v jq >/dev/null || {
	echo "Falta jq" >&2
	exit 1
}

# Host folder mounted at a path in the app container, as compose resolves it.
host_dir() {
	"${compose[@]}" config --format json |
		jq -er --arg target "$1" '.services.app.volumes[] | select(.target == $target) | .source'
}

data_dir=$(host_dir /data)
mkdir -p "$dest"

echo "Base de datos → $dest/jellycartoon.dump"
# Has password hashes and sessions: readable only by its owner, like .env below.
(umask 077 && "${compose[@]}" exec -T db pg_dump -U jellycartoon -Fc jellycartoon >"$dest/jellycartoon.dump.part")
mv "$dest/jellycartoon.dump.part" "$dest/jellycartoon.dump"

echo "Convertidos ($data_dir) → $dest/data"
rsync -a --delete "$data_dir/" "$dest/data/"

if $media; then
	media_dir=$(host_dir /media)
	echo "Originales ($media_dir) → $dest/media"
	rsync -a --delete "$media_dir/" "$dest/media/"
fi

# Holds BETTER_AUTH_SECRET: readable only by its owner.
install -m 600 "$(dirname "$compose_file")/.env" "$dest/.env"

echo "Copia terminada en $dest"
