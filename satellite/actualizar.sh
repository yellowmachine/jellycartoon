#!/usr/bin/env bash
# The satellite updated only to an image signed with the family's key (#643, phase 4), instead of
# WUD: someone who got into the GitHub account could publish an image, but not sign it.
#
#   ./actualizar.sh             look now, and update if there is a newer signed version
#   ./actualizar.sh --instalar  also every night at 4:30 (crontab), from this folder
#
# It needs, beside it, compose.prod.yaml, .env and cosign.pub: the public key, copied once when
# installing and never downloaded again (a key taken from GitHub would be the attacker's). The image
# is checked with cosign (its own image, pinned by digest), pinned in .env by its digest
# (SATELLITE_IMAGE), and never an older version than the running one.
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")"

REPO=${SATELLITE_REPO:-ghcr.io/yellowmachine/jellycartoon-satellite}
# cosign v3.1.6 (https://github.com/sigstore/cosign), by digest: never another without changing it here.
COSIGN=ghcr.io/sigstore/cosign/cosign:v3.1.6@sha256:7d08ec40d6f6fd9ced81a498c367ee6d4dd90d73218f58a791f78661bdbef769
CONTAINER=${SATELLITE_CONTAINER:-satelite-satellite-1}

log() { echo "$(date '+%F %T') $*"; }

if [ "${1:-}" = "--instalar" ]; then
	line="30 4 * * * $PWD/actualizar.sh >> $PWD/actualizar.log 2>&1"
	(crontab -l 2>/dev/null | grep -vF "$PWD/actualizar.sh"; echo "$line") | crontab -
	log "Instalado: cada noche a las 4:30 ($PWD/actualizar.log)"
fi

[ -f cosign.pub ] || { log "Falta cosign.pub junto a este script: no se actualiza"; exit 1; }
[ -f .env ] || { log "Falta .env junto a este script"; exit 1; }

channel=$(grep -E '^IMAGE_TAG=' .env | tail -1 | cut -d= -f2- | tr -d "\"'" || true)
channel=${channel:-stable}

# Checked on the tag, the digest from what was checked: the image pulled is the one signed.
# (COSIGN_TEST: only for its test, against a registry on this machine.)
# shellcheck disable=SC2086
if ! out=$(docker run --rm ${COSIGN_TEST:+--network host} -v "$PWD/cosign.pub:/clave.pub:ro" "$COSIGN" \
	verify --key /clave.pub --insecure-ignore-tlog ${COSIGN_TEST:+--allow-insecure-registry} \
	"$REPO:$channel" 2>/dev/null); then
	log "$REPO:$channel no tiene una firma válida con cosign.pub: no se instala"
	exit 1
fi
digest=$(printf '%s' "$out" | grep -o '"docker-manifest-digest":"sha256:[0-9a-f]\{64\}"' | head -1 | cut -d'"' -f4)
[ -n "$digest" ] || { log "La firma no dice qué imagen es: no se instala"; exit 1; }
target="$REPO@$digest"

current=$(grep -E '^SATELLITE_IMAGE=' .env | tail -1 | cut -d= -f2- | tr -d "\"'" || true)
if [ "$current" = "$target" ]; then
	exit 0
fi

docker pull -q "$target" >/dev/null
label='{{index .Config.Labels "org.opencontainers.image.version"}}'
new=$(docker image inspect --format "$label" "$target")
old=$(docker inspect --format "$label" "$CONTAINER" 2>/dev/null || true)
# An older one, even signed, is not taken: it could bring back a fixed hole.
if [ -n "$old" ] && [ "$old" != "$new" ] &&
	[ "$(printf '%s\n%s\n' "${new#v}" "${old#v}" | sort -V | tail -1)" = "${old#v}" ]; then
	log "$new es más antigua que $old: no se instala"
	exit 1
fi

if grep -qE '^SATELLITE_IMAGE=' .env; then
	sed -i "s|^SATELLITE_IMAGE=.*|SATELLITE_IMAGE=\"$target\"|" .env
else
	printf '\nSATELLITE_IMAGE="%s"\n' "$target" >> .env
fi
docker compose -f compose.prod.yaml up -d satellite
docker image prune -f >/dev/null
log "Actualizado a $new ($digest)"
