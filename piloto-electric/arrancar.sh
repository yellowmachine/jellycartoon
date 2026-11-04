#!/usr/bin/env bash
# El piloto de Electric (#394), todo aislado:
#   ./arrancar.sh            bases, Electric, migraciones y las dos apps (Seilide :3470, casa :3460)
#   ./arrancar.sh compilar   antes, compila las dos apps
#   ./arrancar.sh parar      para las apps y los contenedores, sin borrar datos
#   ./arrancar.sh borrar     para y borra también los datos
# Con --no-env-file: el .env de la raíz son claves de verdad y aquí no pintan nada.
set -euo pipefail
cd "$(dirname "$0")"
raiz=$(cd .. && pwd)
datos=$PWD/.datos
pids=$datos/pids

parar_apps() {
	[[ -d $pids ]] || return 0
	for f in "$pids"/*; do
		[[ -e $f ]] || continue
		pid=$(cat "$f")
		# Solo si sigue siendo nuestra, por su entorno: el :3000 de verdad no se toca nunca.
		if [[ -r /proc/$pid/environ ]] && tr '\0' '\n' <"/proc/$pid/environ" | grep -qx 'PILOTO_ELECTRIC=1'; then
			kill -9 "$pid"
		fi
		rm -f "$f"
	done
}

case ${1:-} in
parar)
	parar_apps
	docker compose stop
	exit 0
	;;
borrar)
	parar_apps
	docker compose down -v
	rm -rf "$datos"
	exit 0
	;;
compilar)
	(cd "$raiz/nube" && DATABASE_URL=postgres://build/build ORIGIN=http://localhost BETTER_AUTH_SECRET=build bun run build)
	(cd "$raiz" && DATABASE_URL=postgres://build/build ORIGIN=http://localhost BETTER_AUTH_SECRET=build bun run build)
	;;
esac

mkdir -p "$datos"/{media,cine,musica,juegos,casa,pids}
docker compose up -d --wait seilide-db casa-db
docker compose up -d electric

(cd "$raiz/nube" && MIGRATE_DATABASE_URL=postgres://nube:nube@127.0.0.1:5440/nube \
	ADMIN_EMAIL=familia-a@piloto.test ADMIN_FAMILY='Familia A' bun --no-env-file scripts/migrate.ts)
(cd "$raiz" && DATABASE_URL=postgres://jellycartoon:jellycartoon@127.0.0.1:5442/jellycartoon \
	bun --no-env-file scripts/migrate.ts)

docker exec -i piloto-electric-seilide-db-1 psql -v ON_ERROR_STOP=1 -q -U nube -d nube <publicar.sql

(cd "$raiz" && bun --no-env-file "$PWD/piloto-electric/preparar.ts")

parar_apps

env -i PATH="$PATH" HOME="$HOME" PILOTO_ELECTRIC=1 HOST=127.0.0.1 PORT=3470 \
	DATABASE_URL=postgres://nube_app:nube_app@127.0.0.1:5440/nube \
	ORIGIN=https://127.0.0.1:3470 BETTER_AUTH_SECRET=piloto-seilide-secreto-de-pruebas-32 \
	S3_ENDPOINT=http://127.0.0.1:1 S3_BUCKET=nube S3_ACCESS_KEY_ID=nube S3_SECRET_ACCESS_KEY=nube \
	ELECTRIC_URL=http://127.0.0.1:5441 ELECTRIC_SECRET=piloto-secreto \
	nohup bun --no-env-file "$raiz/nube/build/index.js" >"$datos/seilide.log" 2>&1 &
echo $! >"$pids/seilide"

env -i PATH="$PATH" HOME="$HOME" PILOTO_ELECTRIC=1 HOST=127.0.0.1 PORT=3460 \
	DATABASE_URL=postgres://jellycartoon:jellycartoon@127.0.0.1:5442/jellycartoon \
	ORIGIN=https://127.0.0.1:3460 BETTER_AUTH_SECRET=piloto-casa-secreto-de-pruebas-32 \
	MEDIA_DIR="$datos/media" DATA_DIR="$datos/casa" CINEMA_DIR="$datos/cine" MUSIC_DIR="$datos/musica" \
	GAMES_DIR="$datos/juegos" DELETE_SOURCES=false OPENROUTER_API_KEY= \
	ELECTRIC_REPLICA=1 \
	nohup bun --no-env-file "$raiz/build/index.js" >"$datos/casa.log" 2>&1 &
echo $! >"$pids/casa"

echo "Seilide: http://127.0.0.1:3470 · casa: http://127.0.0.1:3460 · Electric: http://127.0.0.1:5441"
