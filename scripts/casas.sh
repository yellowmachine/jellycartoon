#!/usr/bin/env bash
# How every JellyCartoon install is, from this PC, over SSH (Tailscale): its version, its
# containers, the free disk where its data is and the last errors of its Registro. It only reads:
# nothing is changed. A first version, to grow with use.
#
#   scripts/casas.sh                      # todas las casas de ~/.config/jellycartoon/casas
#   scripts/casas.sh salon padres         # solo esas, por su nombre en ese fichero
#   scripts/casas.sh prueba=amigo@pc-amigo   # una que no está en el fichero
#
# ~/.config/jellycartoon/casas, una casa por línea (# para comentarios):
#
#   # nombre   ssh                 proyecto de compose (opcional, «jellycartoon»: su carpeta)
#   salon      salon.local
#   padres     miguel@padres-pc
#
# In each house, Docker is asked as the SSH user or, if it cannot, with `sudo -n` (never asking
# for a password): the user needs one of the two.
set -euo pipefail

config=${JELLYCARTOON_CASAS:-$HOME/.config/jellycartoon/casas}

# name, ssh destination and compose project of every house, one per line.
houses=()
if [[ -f $config ]]; then
	while read -r name dest project _; do
		[[ -z $name || $name == \#* ]] && continue
		houses+=("$name $dest ${project:-jellycartoon}")
	done <"$config"
fi

selected=()
if [[ $# -eq 0 ]]; then
	selected=("${houses[@]}")
	[[ ${#selected[@]} -gt 0 ]] || {
		echo "No hay casas: créalas en $config (mira el principio de $0)" >&2
		exit 1
	}
else
	for arg in "$@"; do
		if [[ $arg == *=* ]]; then
			selected+=("${arg%%=*} ${arg#*=} jellycartoon")
			continue
		fi
		found=
		for house in "${houses[@]}"; do
			[[ ${house%% *} == "$arg" ]] && found=$house
		done
		[[ -n $found ]] || {
			echo "No conozco la casa «$arg» (mira $config)" >&2
			exit 1
		}
		selected+=("$found")
	done
fi

# What runs in each house: bash, whatever the user's shell is (fish in the living room).
read -r -d '' remote <<'EOF' || true
set -u
project=$1
docker=(docker)
if ! docker info >/dev/null 2>&1; then
	docker=(sudo -n docker)
	if ! "${docker[@]}" info >/dev/null 2>&1; then
		echo "  ✗ No se puede usar Docker: el usuario no está en el grupo docker ni tiene sudo sin contraseña"
		exit 0
	fi
fi
container() {
	"${docker[@]}" ps -a --filter "label=com.docker.compose.project=$project" \
		--filter "label=com.docker.compose.service=$1" --format '{{.Names}}' | head -1
}
app=$(container app)
db=$(container db)
if [[ -z $app ]]; then
	echo "  ✗ No hay JellyCartoon (proyecto de compose «$project»)"
	exit 0
fi

version=$("${docker[@]}" inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$app" |
	sed -n 's/^APP_VERSION=//p')
echo "  Versión ${version:-?} · encendido $(uptime -p | sed 's/^up //')"

echo "  Contenedores:"
"${docker[@]}" ps -a --filter "label=com.docker.compose.project=$project" \
	--format '{{.Label "com.docker.compose.service"}}|{{.Status}}' | sort |
	while IFS='|' read -r service status; do
		case $status in
			Up*unhealthy*|Exited*|Restarting*|Dead*|Created*) mark='✗' ;;
			*) mark='·' ;;
		esac
		printf '    %s %-10s %s\n' "$mark" "$service" "$status"
	done

data=$("${docker[@]}" inspect -f '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Source}}{{end}}{{end}}' "$app")
if [[ -n $data && -d $data ]]; then
	read -r avail used < <(df -h --output=avail,pcent "$data" | tail -1)
	echo "  Disco de los datos ($data): $avail libres, $used usado"
fi

if [[ -n $db ]]; then
	query() {
		"${docker[@]}" exec "$db" psql -U jellycartoon -d jellycartoon -At -F ' · ' -c "$1" 2>/dev/null
	}
	counts=$(query "select count(*) filter (where level = 'error'), count(*) filter (where level = 'warn') from log_entry where at > now() - interval '24 hours'")
	errors=${counts%% · *}
	warnings=${counts##* · }
	echo "  Registro, últimas 24 h: ${errors:-?} errores, ${warnings:-?} avisos"
	query "select to_char(at, 'DD/MM HH24:MI'), source, left(message, 110) from log_entry where level = 'error' and at > now() - interval '24 hours' order by at desc limit 5" |
		sed 's/^/    ✗ /'
fi
EOF

for house in "${selected[@]}"; do
	read -r name dest project <<<"$house"
	echo "== $name ($dest)"
	ssh -o ConnectTimeout=8 -o BatchMode=yes "$dest" bash -s -- "$project" <<<"$remote" ||
		echo "  ✗ No se pudo entrar por SSH"
	echo
done
