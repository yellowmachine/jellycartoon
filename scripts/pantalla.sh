#!/usr/bin/env bash
# Installs, from this PC over SSH, what the PC with the screen needs besides the app: the mpv
# service, its keys and menu for the remote (deploy/mpv) and, if the remote's receiver is plugged
# in, its udev hwdb. Only what changed, showing how; run it again whenever. See "Ver en el salón"
# and "Mando del salón" in the README.
#
#   scripts/pantalla.sh                         # todas las casas de ~/.config/jellycartoon/casas
#   scripts/pantalla.sh salon                   # solo esa, por su nombre en ese fichero
#   scripts/pantalla.sh prueba=amigo@pc-amigo   # una que no está en el fichero
#
# The hwdb goes to /etc and asks for the house's sudo password here. mpv is restarted only with
# nothing playing; otherwise it says so and is left as it is.
set -euo pipefail

source "$(dirname "$0")/lib/casas.sh"
select_houses "$@"

deploy=$(cd "$(dirname "$0")/../deploy" && pwd)

# What runs in each house, from the folder the files were copied to: bash, whatever the user's
# shell is (fish in the living room).
read -r -d '' remote <<'EOF' || true
set -u
project=$1
files=$(dirname "$0")
trap 'rm -rf "$files"' EXIT
changed=

# Copies $1 to $2 if they differ, showing the difference; true if it copied.
install_file() {
	if cmp -s "$1" "$2"; then
		echo "  · $2: igual"
		return 1
	fi
	if [[ -f $2 ]]; then
		echo "  ✓ $2: actualizado"
		diff -u "$2" "$1" | tail -n +3 | sed 's/^/      /'
	else
		echo "  ✓ $2: nuevo"
	fi
	mkdir -p "$(dirname "$2")"
	cp "$1" "$2"
}

# The socket goes in the app's /data (HOST_DATA_DIR), as in casas.sh.
docker=(docker)
docker info >/dev/null 2>&1 || docker=(sudo -n docker)
app=$("${docker[@]}" ps -a --filter "label=com.docker.compose.project=$project" \
	--filter "label=com.docker.compose.service=app" --format '{{.Names}}' 2>/dev/null | head -1)
data=
[[ -n $app ]] &&
	data=$("${docker[@]}" inspect -f '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Source}}{{end}}{{end}}' "$app")
if [[ -z $data ]]; then
	echo "  ✗ No encuentro la carpeta de datos de JellyCartoon (proyecto de compose «$project»): sin servicio de mpv"
else
	socket=$data/mpv.sock
	sed "s|@SOCKET@|$socket|" "$files/jellycartoon-mpv.service" >"$files/service"
	if install_file "$files/service" ~/.config/systemd/user/jellycartoon-mpv.service; then
		systemctl --user daemon-reload
		systemctl --user enable jellycartoon-mpv >/dev/null 2>&1
		changed=1
	fi
fi

install_file "$files/mpv/input.conf" ~/.config/mpv/input.conf && changed=1
install_file "$files/mpv/scripts/mando.lua" ~/.config/mpv/scripts/mando.lua && changed=1

# The remote's receiver: vendor and product as in the hwdb (4842:0001).
receiver=
for device in /sys/bus/usb/devices/*; do
	[[ $(cat "$device/idVendor" 2>/dev/null) == 4842 && $(cat "$device/idProduct") == 0001 ]] &&
		receiver=1
done
if [[ -n $receiver ]]; then
	hwdb=/etc/udev/hwdb.d/70-mando-g20s.hwdb
	if cmp -s "$files/70-mando-g20s.hwdb" "$hwdb"; then
		echo "  · $hwdb: igual"
	else
		echo "  ✓ $hwdb: hace falta sudo"
		sudo install -D -m 644 "$files/70-mando-g20s.hwdb" "$hwdb"
		sudo systemd-hwdb update
		sudo udevadm trigger --sysname-match="event*"
	fi
else
	echo "  · No está el receptor del mando G20S Pro: sin hwdb"
fi

if [[ -z $changed ]]; then
	exit 0
fi
if ! systemctl --user is-active -q jellycartoon-mpv; then
	systemctl --user start jellycartoon-mpv && echo "  ✓ mpv arrancado"
	exit 0
fi
# Asked over its socket: true with nothing playing.
idle=$(python3 -c '
import json, socket, sys
s = socket.socket(socket.AF_UNIX)
s.settimeout(2)
s.connect(sys.argv[1])
s.sendall(b"{\"command\": [\"get_property\", \"idle-active\"]}\n")
for line in s.makefile():
    reply = json.loads(line)
    if "error" in reply:
        print(str(reply.get("data")).lower())
        break
' "${socket:-$data/mpv.sock}" 2>/dev/null || echo "?")
if [[ $idle == true ]]; then
	systemctl --user restart jellycartoon-mpv && echo "  ✓ mpv reiniciado"
else
	echo "  ! Hay algo puesto en mpv: los cambios valen al reiniciarlo (systemctl --user restart jellycartoon-mpv)"
fi
EOF

for house in "${selected[@]}"; do
	read -r name dest project <<<"$house"
	echo "== $name ($dest)"
	# The files and this script to a folder there; then -t, so that sudo can ask for the password.
	if ! dir=$(ssh -o ConnectTimeout=8 "$dest" mktemp -d); then
		echo "  ✗ No se pudo entrar por SSH"
		echo
		continue
	fi
	tar -C "$deploy" -c mpv 70-mando-g20s.hwdb jellycartoon-mpv.service | ssh "$dest" tar -x -C "$dir"
	ssh "$dest" "cat > $dir/pantalla.sh" <<<"$remote"
	ssh -t "$dest" bash "$dir/pantalla.sh" "$project" || echo "  ✗ Algo falló en $name"
	echo
done
