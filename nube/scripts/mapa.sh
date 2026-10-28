#!/usr/bin/env bash
# The road mode's map (#78, #253), in <folder>/mapa: Spain's map, cut out of Protomaps' daily build
# of OpenStreetMap (https://docs.protomaps.com), and the fonts and icons its style uses
# (protomaps/basemaps-assets). Run it on the VPS, from the repository; again whenever, to bring the
# streets up to date. It needs Docker and curl.
#
#   nube/scripts/mapa.sh /opt/nube            # MAP_HOST_DIR (/opt/nube/mapa): España, Baleares y Canarias
#   nube/scripts/mapa.sh /opt/nube --bbox=-3.9,40.3,-3.5,40.6   # otra zona (oeste,sur,este,norte)
#
# The app serves it as it is (/mapa): nothing to restart. The map is replaced only once it is
# whole, so the one before keeps working meanwhile.
set -euo pipefail

usage() {
	echo "Uso: $0 <carpeta (la de MAP_HOST_DIR sin /mapa, p. ej. /opt/nube)> [--bbox=oeste,sur,este,norte]" >&2
	exit 1
}

[[ $# -ge 1 && -d $1 ]] || usage
dir=$(cd "$1" && pwd)/mapa
# Spain, with the Balearic and the Canary Islands; Portugal and bits of France and Morocco come
# along, as the box is square.
bbox=${2:---bbox=-18.2,27.6,4.4,43.9}
[[ $bbox == --bbox=* ]] || usage

# The CLI as a Docker image (its entrypoint is the binary): https://hub.docker.com/r/protomaps/go-pmtiles
PMTILES_IMAGE=protomaps/go-pmtiles:v1.31.2
ASSETS=https://codeload.github.com/protomaps/basemaps-assets/tar.gz/refs/heads/main

mkdir -p "$dir"

# The newest daily build, as its list says: https://build-metadata.protomaps.dev/builds.json
build=$(curl -fsS https://build-metadata.protomaps.dev/builds.json |
	grep -oE '"key": *"[0-9]{8}\.pmtiles"' | tail -1 | grep -oE '[0-9]{8}\.pmtiles')
echo "Mapa: recortando $build ($bbox) en $dir/espana.pmtiles…"
# Only the tiles of the box are downloaded, not the planet's file.
docker run --rm -u "$(id -u):$(id -g)" -v "$dir:/data" "$PMTILES_IMAGE" \
	extract "https://build.protomaps.com/$build" /data/espana.part.pmtiles "$bbox"
mv "$dir/espana.part.pmtiles" "$dir/espana.pmtiles"

echo "Mapa: fuentes e iconos…"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
curl -fsSL "$ASSETS" | tar -xz -C "$tmp" --strip-components=1 \
	basemaps-assets-main/fonts basemaps-assets-main/sprites/v4
rm -rf "$dir/fonts" "$dir/sprites"
mv "$tmp/fonts" "$dir/fonts"
mkdir -p "$dir/sprites"
mv "$tmp/sprites/v4" "$dir/sprites/v4"

echo "Mapa listo: $(du -sh "$dir/espana.pmtiles" | cut -f1) ($build)"
