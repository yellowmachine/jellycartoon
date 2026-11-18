#!/usr/bin/env bash
# The PC's Flatpak apps for JellyCartoon's TV shortcuts (#530), one order per connection
# (jellycartoon-apps@.service gives it the socket as stdin and stdout; the journal, stderr):
#   list        the apps installed, one per line: «<id>\t<name>»
#   run <id>    «ok» and the app opened (as long as it runs), or «no»
#   icon <id>   its biggest PNG icon as Flatpak exports it, or nothing
# Only an installed app's id: nothing else gets to flatpak. Installed by scripts/pantalla.sh in
# ~/.local/bin.
set -u

read -r order id
# An app id, as Flatpak names them: three parts or more, «com.ktechpit.red».
valid() { [[ $id =~ ^[A-Za-z][A-Za-z0-9_-]*(\.[A-Za-z0-9_-]+){2,}$ ]]; }

case $order in
list)
	exec flatpak list --app --columns=application,name
	;;
run)
	if ! valid || ! flatpak info "$id" >/dev/null 2>&1; then
		echo no
		echo "No es una app instalada: $id" >&2
		exit 0
	fi
	echo ok
	echo "Abriendo $id" >&2
	# Off the socket, so that JellyCartoon has its answer now; the app runs in this unit.
	exec flatpak run "$id" </dev/null >/dev/null
	;;
icon)
	valid || exit 0
	for root in "${XDG_DATA_HOME:-$HOME/.local/share}/flatpak" /var/lib/flatpak; do
		for size in 512x512 256x256 192x192 128x128 96x96 64x64; do
			file=$root/exports/share/icons/hicolor/$size/apps/$id.png
			if [[ -f $file ]]; then
				exec cat "$file"
			fi
		done
	done
	echo "Sin icono PNG: $id" >&2
	;;
*)
	echo "Orden desconocida: $order" >&2
	;;
esac
