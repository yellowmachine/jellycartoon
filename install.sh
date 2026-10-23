#!/bin/sh
# First step of #103: downloads compose.prod.yaml and .env.example from the last release (main)
# into the current folder, and shows what this system has for jellycartoon. It installs nothing and
# never overwrites a file that is already there. See "Instalar" in the README for the rest.
#
#   curl -fsSL https://raw.githubusercontent.com/yellowmachine/jellycartoon/main/install.sh | sh
set -eu

base=https://raw.githubusercontent.com/yellowmachine/jellycartoon/main

for file in compose.prod.yaml .env.example; do
	if [ -e "$file" ]; then
		echo "Ya está $file: no lo toco."
	else
		curl -fsSL "$base/$file" -o "$file"
		echo "Descargado $file."
	fi
done

# What the full install.sh will have to deal with; paste it in #103.
echo
echo "--- Sistema (para #103) ---"
. /etc/os-release 2>/dev/null && echo "SO: ${PRETTY_NAME:-?}"
echo "Kernel: $(uname -r) ($(uname -m))"
if command -v rpm-ostree >/dev/null; then
	echo "Imagen: $(rpm-ostree status --booted --json 2>/dev/null | grep -o '"container-image-reference" *: *"[^"]*"' | head -1 | cut -d'"' -f4)"
fi
echo "Sistema de ficheros de esta carpeta: $(stat -f -c %T .)"
echo "Usuario: $(id -un), grupos: $(id -Gn)"
for tool in docker podman flatpak brew mpv; do
	if command -v "$tool" >/dev/null; then echo "$tool: $(command -v "$tool")"; else echo "$tool: no"; fi
done
if command -v docker >/dev/null; then
	docker version --format 'Docker: {{.Server.Version}}' 2>&1 | head -1 || true
	docker compose version 2>&1 | head -1 || true
fi
if command -v flatpak >/dev/null; then
	flatpak info io.mpv.Mpv >/dev/null 2>&1 && echo "mpv en flatpak: sí" || echo "mpv en flatpak: no"
fi
