#!/usr/bin/env bash
# Signs a release's satellite image (#643, phase 4) with the family's key, which is only on this
# PC, never in GitHub: the satellites (satellite/actualizar.sh) install only signed images.
#
#   scripts/firmar-satelite.sh v2.174.0
#
# After the release's «Docker image» Action has finished. The key, ~/.config/seilide/cosign.key
# (or COSIGN_KEY), made once with:
#   mkdir -p ~/.config/seilide && cd ~/.config/seilide && docker run --rm -it --user "$(id -u)" \
#     -v "$PWD:/w" -w /w ghcr.io/sigstore/cosign/cosign:v3.1.6 generate-key-pair
#   (in a real terminal: it asks for the password)
# and its cosign.pub copied to satellite/cosign.pub. Pushing the signature to ghcr needs the gh
# login with packages (`gh auth refresh -s write:packages`). Without the transparency log: what
# guards it is the key, and the satellites check it with no service of Sigstore in between.
set -euo pipefail

version=${1:?Falta la versión: scripts/firmar-satelite.sh v2.174.0}
key=${COSIGN_KEY:-$HOME/.config/seilide/cosign.key}
REPO=ghcr.io/yellowmachine/jellycartoon-satellite
COSIGN=ghcr.io/sigstore/cosign/cosign:v3.1.6@sha256:7d08ec40d6f6fd9ced81a498c367ee6d4dd90d73218f58a791f78661bdbef769
root=$(cd "$(dirname "$0")/.." && pwd)

[ -f "$key" ] || { echo "No está la clave en $key"; exit 1; }
# Asked once, for both steps; only in this process's environment.
if [ -z "${COSIGN_PASSWORD+x}" ]; then
	read -rsp "Contraseña de la clave: " COSIGN_PASSWORD
	echo
fi
export COSIGN_PASSWORD
# The key must be the one the satellites have.
pub=$(mktemp -d)
trap 'rm -rf "$pub"' EXIT
docker run --rm --user "$(id -u)" -e COSIGN_PASSWORD -v "$(dirname "$key"):/k:ro" -v "$pub:/o" \
	"$COSIGN" public-key --key "/k/$(basename "$key")" --outfile /o/cosign.pub >/dev/null
cmp -s "$pub/cosign.pub" "$root/satellite/cosign.pub" ||
	{ echo "Esa clave no es la de satellite/cosign.pub"; exit 1; }

# The index of every platform, by digest: the signature is of it, whatever tag points to it.
digest=$(docker buildx imagetools inspect "$REPO:$version" --format '{{json .Manifest}}' | jq -r .digest)
[[ $digest == sha256:* ]] || { echo "No encuentro $REPO:$version"; exit 1; }

echo "Firmando $REPO@$digest ($version)"
printf '%s' '{"mediaType":"application/vnd.dev.sigstore.signingconfig.v0.2+json","rekorTlogConfig":{},"tsaConfig":{}}' \
	> "$pub/sin-registro.json"
# ghcr's login for pushing the signature, gh's, in a file only for this: not on the command line.
(
	umask 077
	auth=$(printf '%s:%s' "$(gh api user -q .login)" "$(gh auth token)" | base64 -w0)
	printf '{"auths":{"ghcr.io":{"auth":"%s"}}}' "$auth" > "$pub/config.json"
)
docker run --rm --user "$(id -u)" -e COSIGN_PASSWORD -e DOCKER_CONFIG=/o \
	-v "$(dirname "$key"):/k:ro" -v "$pub:/o:ro" "$COSIGN" \
	sign -y --key "/k/$(basename "$key")" --signing-config /o/sin-registro.json \
	"$REPO@$digest"

docker run --rm -v "$root/satellite/cosign.pub:/clave.pub:ro" "$COSIGN" \
	verify --key /clave.pub --insecure-ignore-tlog "$REPO:$version" >/dev/null
echo "Firmada y comprobada: los satélites la instalan esta noche"
