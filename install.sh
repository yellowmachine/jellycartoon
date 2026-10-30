#!/bin/sh
# Installs JellyCartoon in ~/jellycartoon on any x86_64 Linux with Docker (#103): checks Docker,
# downloads compose.prod.yaml from main (the last release), asks the least it can, writes the .env
# with its secrets, starts it and says the address to open. Run it again whenever: a file that is
# already there is never overwritten, and with a .env it only starts what it says. The screen's
# part (mpv, the remote) is scripts/pantalla.sh; the rest, "Producción" in the README.
#
#   curl -fsSL https://raw.githubusercontent.com/yellowmachine/jellycartoon/main/install.sh | sh
set -eu

base=https://raw.githubusercontent.com/yellowmachine/jellycartoon/main
dir=$HOME/jellycartoon
compose="docker compose -f compose.prod.yaml"

say() { printf '%s\n' "$*"; }
fail() {
	printf '\n✗ %s\n' "$*" >&2
	exit 1
}

# With `curl | sh` the script is stdin: the answers come from the terminal.
if ! (: </dev/tty) 2>/dev/null; then
	fail "Hace falta una terminal para contestar las preguntas. Ábrela y pega el comando ahí."
fi
exec 3</dev/tty

# ask <question> <default>: the answer, or the default if left empty.
ask() {
	if [ -n "$2" ]; then printf '%s [%s]: ' "$1" "$2" >&2; else printf '%s: ' "$1" >&2; fi
	read -r answer <&3 || answer=
	printf '%s' "${answer:-$2}"
}

# yes <question> <s|n>: true for a yes, with the default if left empty.
yes() {
	if [ "$2" = s ]; then hint=S/n; else hint=s/N; fi
	printf '%s [%s]: ' "$1" "$hint" >&2
	read -r answer <&3 || answer=
	case ${answer:-$2} in [sSyY]*) return 0 ;; *) return 1 ;; esac
}

secret() { openssl rand -hex 32; }

# The value of a variable in the .env, without its quotes.
env_value() { sed -n "s/^$1=\"\{0,1\}\([^\"]*\)\"\{0,1\}\$/\1/p" .env | tail -n 1; }

say "Instalar JellyCartoon"
say "====================="
say

# --- What it needs -------------------------------------------------------------------------------

[ "$(uname -s)" = Linux ] || fail "JellyCartoon se instala en un ordenador con Linux."
# The images are built only for x86_64 (PCs), not for ARM (Raspberry Pi…).
[ "$(uname -m)" = x86_64 ] || fail "Este ordenador es $(uname -m): JellyCartoon solo funciona en PCs (x86_64)."
command -v curl >/dev/null || fail "Falta curl."
command -v openssl >/dev/null || fail "Falta openssl."

image=
if command -v rpm-ostree >/dev/null; then
	image=$(rpm-ostree status --booted --json 2>/dev/null |
		grep -o '"container-image-reference" *: *"[^"]*"' | head -1 | cut -d'"' -f4) || true
fi

if ! command -v docker >/dev/null; then
	case $image in
	*ublue-os/aurora:* | *ublue-os/aurora-nvidia*:*)
		# https://docs.getaurora.dev/dx/aurora-dx-intro, as tested in #103.
		fail "Este Aurora no trae Docker: hay que pasar a Aurora-DX, una vez. Paso a paso:
  1. En una terminal, escribe: ujust devmode
     Si pregunta por las aplicaciones de desarrollo o las fuentes, contesta que no: no hacen falta.
     Tarda unos minutos (descarga unos 4,5 GB).
  2. Reinicia el ordenador.
  3. En una terminal, escribe: ujust dx-group
     De los grupos que ofrece, elige solo «docker».
  4. Reinicia otra vez, y vuelve a pegar el comando de instalar."
		;;
	*ublue-os/bazzite*)
		fail "Este Bazzite no trae Docker: hace falta Bazzite-DX. Cómo cambiar de imagen:
  https://docs.bazzite.gg/Installing_and_Managing_Software/Updates_Rollbacks_and_Rebasing/rebase_guide/
Después, vuelve a pegar el comando de instalar."
		;;
	*)
		fail "Falta Docker. Cómo instalarlo: https://docs.docker.com/engine/install/
Después, vuelve a pegar el comando de instalar."
		;;
	esac
fi

if ! docker info >/dev/null 2>&1; then
	if systemctl is-active --quiet docker 2>/dev/null; then
		fail "Docker funciona, pero este usuario ($(id -un)) no puede usarlo. Para darle permiso:
  sudo usermod -aG docker $(id -un)
Después, cierra la sesión, vuelve a entrar y pega otra vez el comando de instalar."
	fi
	fail "Docker no está en marcha. Para arrancarlo (y que arranque solo al encender):
  sudo systemctl enable --now docker
Después, vuelve a pegar el comando de instalar."
fi

# compose.prod.yaml uses `configs` with `content`, from Compose 2.23.
version=$(docker compose version --short 2>/dev/null) || fail "Falta Docker Compose: https://docs.docker.com/compose/install/linux/"
major=${version%%.*}
minor=${version#*.}
minor=${minor%%.*}
if [ "$major" -lt 2 ] || { [ "$major" -eq 2 ] && [ "$minor" -lt 23 ]; }; then
	fail "Docker Compose $version es antiguo: hace falta la 2.23 o una más nueva."
fi

# The docker group is as good as root (https://docs.docker.com/engine/security/#docker-daemon-attack-surface).
if id -Gn | tr ' ' '\n' | grep -qx docker; then
	say "Aviso: $(id -un) está en el grupo docker, que puede hacer cualquier cosa en este ordenador."
	say "En tu casa vale. Si instalas en casa de otra persona, mejor con un usuario administrador"
	say "aparte, y que el suyo no esté en ese grupo («Instalar en casa de otra persona», en el README)."
	say
fi

# --- The files -----------------------------------------------------------------------------------

mkdir -p "$dir"
cd "$dir"
say "Carpeta: $dir"

if [ -e compose.prod.yaml ]; then
	say "Ya está compose.prod.yaml: no lo toco."
else
	curl -fsSL "$base/compose.prod.yaml" -o compose.prod.yaml.part
	mv compose.prod.yaml.part compose.prod.yaml
	say "Descargado compose.prod.yaml."
fi

if [ -e .env ]; then
	say "Ya está .env: uso el que hay, sin preguntar nada."
else
	say
	say "Unas preguntas (Intro deja lo que va entre corchetes)."
	say
	say "¿Cómo se llega a JellyCartoon?"
	say "  1. Solo en casa, con el nombre de este ordenador. Cada móvil, tablet u ordenador"
	say "     instala una vez un certificado (te digo cómo al final). Las teles, a menudo no pueden."
	say "  2. Con un dominio tuyo en Cloudflare (unos 10 € al año). No hay que instalar nada en"
	say "     ningún aparato. Hace falta un token de su API."
	mode=$(ask "Elige 1 o 2" 1)

	case $mode in
	2)
		domain=$(ask "El dominio (por ejemplo jelly.tudominio.es)" "")
		[ -n "$domain" ] || fail "Sin dominio no puedo seguir."
		say "El token de Cloudflare: My Profile → API Tokens, con Zone.Zone:Read y Zone.DNS:Edit sobre su zona."
		token=$(ask "Token" "")
		[ -n "$token" ] || fail "Sin token no puedo seguir."
		origin=https://$domain
		tls=cloudflare
		;;
	*)
		name=$(uname -n)
		name=${name%%.*}
		if [ -z "$name" ] || [ "$name" = localhost ]; then
			fail "Este ordenador no tiene nombre. Ponle uno (sin espacios, por ejemplo salon):
  sudo hostnamectl hostname salon
y vuelve a pegar el comando de instalar."
		fi
		origin=https://$(printf '%s' "$name" | tr '[:upper:]' '[:lower:]').local
		tls=internal
		token=
		;;
	esac

	say
	media=$(ask "Carpeta donde copiarás los capítulos" "$dir/media")
	media=${media%/}

	say
	profiles=
	wud_password=
	if yes "¿Actualizar solo cada noche a la última versión?" s; then
		profiles=updates
		wud_password=$(openssl rand -hex 16)
	fi
	whisper=
	# Whisper runs on the GPU through /dev/dri (compose.prod.yaml).
	if [ -e /dev/dri ] && yes "¿Órdenes de voz y subtítulos automáticos? (descarga un modelo de unos 500 MB)" n; then
		profiles=${profiles:+$profiles,}voz
		whisper=small
	fi

	mkdir -p "$media" data
	umask 077
	{
		say "# Written by install.sh on $(date +%F). The rest of the variables: README, «Producción»."
		say "ORIGIN=\"$origin\""
		say "TLS=\"$tls\""
		[ -z "$token" ] || say "CF_API_TOKEN=\"$token\""
		say "BETTER_AUTH_SECRET=\"$(secret)\""
		say "HOST_MEDIA_DIR=\"$media\""
		say "HOST_DATA_DIR=\"$dir/data\""
		say "PUID=$(id -u)"
		say "PGID=$(id -g)"
		[ -z "$profiles" ] || say "COMPOSE_PROFILES=\"$profiles\""
		[ -z "$wud_password" ] || say "WUD_PASSWORD=\"$wud_password\""
		[ -z "$whisper" ] || say "WHISPER_MODEL=\"$whisper\""
	} >.env.part
	mv .env.part .env
	umask 022
	say "Escrito .env (solo lo lee $(id -un))."
fi

origin=$(env_value ORIGIN)
tls=$(env_value TLS)
host=${origin#https://}
host=${host%%/*}
[ -n "$host" ] || fail "En .env falta ORIGIN."

if [ "$tls" = internal ] && ! systemctl is-active --quiet avahi-daemon 2>/dev/null; then
	say
	say "Aviso: avahi no está en marcha, y sin él los demás aparatos no encuentran $host. Para arrancarlo:"
	say "  sudo systemctl enable --now avahi-daemon"
fi

# --- Start ---------------------------------------------------------------------------------------

say
say "Descargando JellyCartoon (la primera vez, unos minutos)…"
$compose pull --quiet
$compose up -d

# Caddy's certificate is for ORIGIN's name only: asked by that name (as a browser does), it
# answers once both the certificate and the app are ready.
say "Esperando a que conteste en $origin…"
tries=0
until curl -fsk -o /dev/null --resolve "$host:443:127.0.0.1" "https://$host/"; do
	tries=$((tries + 1))
	if [ "$tries" -ge 90 ]; then
		fail "No contesta en 3 minutos. Para ver qué pasa:
  cd $dir && $compose logs caddy app"
	fi
	sleep 2
done

say
say "✓ JellyCartoon está en marcha."

if [ "$tls" = internal ]; then
	$compose cp caddy:/data/caddy/pki/authorities/local/root.crt jellycartoon-raiz.crt >/dev/null 2>&1
	say
	say "Falta una cosa en cada aparato que vaya a usarla (móvil, tablet, ordenador), una sola vez:"
	say "instalar el certificado $dir/jellycartoon-raiz.crt. Pásalo por correo, una memoria o la red,"
	say "y sigue los pasos de su sistema en el README, «A. Certificado propio de Caddy»."
	say "Sin él, el navegador dice que la conexión no es segura: no aceptes el aviso, instala el certificado."
	say "Solo funciona con la wifi de casa. Y conviene una IP fija para este ordenador (en el router,"
	say "«reserva DHCP»)."
else
	ip=$(ip -4 route get 1.1.1.1 2>/dev/null | sed -n 's/.* src \([0-9.]*\).*/\1/p')
	say
	say "En Cloudflare, el registro A de $host tiene que llevar a ${ip:-la IP de este ordenador en casa},"
	say "en modo «DNS only» (sin proxy). Y conviene una IP fija para este ordenador (en el router, «reserva DHCP»)."
fi

say
say "Ábrela en el navegador: $origin"
say "La primera cuenta que se crea es la de quien administra: créala tú, ahora. Las demás personas"
say "de la casa se añaden después, en Ajustes → Casa → Personas de la casa."
