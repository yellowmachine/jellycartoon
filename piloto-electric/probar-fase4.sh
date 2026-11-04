#!/usr/bin/env bash
# La fase 4 del piloto (#394): la casa escribe sus etiquetas en Seilide. Con ./arrancar.sh en marcha y
# la base recién hecha.
cd "$(dirname "$0")"; source .datos/llaves.env
B=http://127.0.0.1:3460; O=https://127.0.0.1:3460; J=.datos/cookies; A=http://127.0.0.1:3470/api/casa/etiquetas
Q() { docker exec -i piloto-electric-seilide-db-1 psql -U nube -d nube -Atq "$@"; }
C() { docker exec -i piloto-electric-casa-db-1 psql -U jellycartoon -d jellycartoon -Atq "$@"; }
accion() { # ruta?/accion campo=valor…
  local r=$1; shift; local a=(); for f in "$@"; do a+=(--data-urlencode "$f"); done
  curl -s -m 20 -b $J -H "Origin: $O" -H 'x-sveltekit-action: true' "${a[@]}" "$B/$r" | python3 -I -c '
import json,sys
d=json.loads(sys.stdin.read() or "{}"); print("  ->",d.get("type"),d.get("status",""),(json.loads(d["data"])[1:] if d.get("data") else ""))' 2>&1 | cut -c1-150; }
estado() { echo "  Seilide tag:    $(Q -c "select string_agg(id||'='||name, ', ' order by id) from tag where family_id='$FAMILIA_A'")"
  echo "  casa tag:       $(C -c "select string_agg(id||'='||name, ', ' order by id) from tag")"
  echo "  Seilide series: $(Q -c "select string_agg(series_id||'/'||tag_id, ', ' order by 1) from series_tag where family_id='$FAMILIA_A'")"
  echo "  casa series:    $(C -c "select string_agg(series_id||'/'||tag_id, ', ' order by 1) from series_tag")"
  echo "  casa películas: $(C -c "select string_agg(movie_id||'/'||tag_id, ', ' order by 1) from movie_tag")"; }

rm -f $J
curl -s -m 15 -o /dev/null -c $J -H "Origin: $O" -H 'x-sveltekit-action: false' --data-urlencode email=admin@piloto.test --data-urlencode password=piloto-clave-larga-1 --data-urlencode name=Admin "$B/login?/signUp"
C -c "update session set two_factor_setup = false"
C <<'SQL'
insert into series (id,folder,title) values (7,'siete','Siete'),(8,'ocho','Ocho') on conflict do nothing;
insert into movie (id,path,title,size,mtime) values (5,'/peli.mkv','Peli',1,now()) on conflict do nothing;
SQL
echo "--- 1 etiqueta en una serie, desde la ficha"; accion 'series/7?/addTag' name=Infantil; estado
T=$(C -c "select id from tag where name='infantil'")
echo "--- 2 la misma en otra serie y en una película"; accion 'series/8?/addTag' name=infantil; accion 'cine/5?/addTag' name=infantil; estado
echo "--- 3 quitarla de una serie: sigue, la usan las demás"; accion 'series/8?/removeTag' tagId=$T; estado
echo "--- 4 quitarla de la otra: sigue, la usa la película"; accion 'series/7?/removeTag' tagId=$T; estado
echo "--- 5 quitarla de la película: ya no la usa nadie, se va"; accion 'cine/5?/removeTag' tagId=$T; estado
echo "--- 6 renombrar"; accion 'series/7?/addTag' name=comedya; X=$(C -c "select id from tag where name='comedya'"); accion 'library/etiquetas?/rename' tagId=$X name=comedia; estado
echo "--- 7 renombrar a una existente: se juntan, sin perder la película"
accion 'series/8?/addTag' name=humor; Y=$(C -c "select id from tag where name='humor'"); accion 'cine/5?/addTag' name=humor
accion 'library/etiquetas?/rename' tagId=$Y name=comedia; accion 'library/etiquetas?/rename' tagId=$Y name=comedia merge=1; estado
echo "--- 8 borrar"; accion 'series/8?/addTag' name=borrame; Z=$(C -c "select id from tag where name='borrame'"); accion 'cine/5?/addTag' name=borrame; accion 'library/etiquetas?/delete' tagId=$Z; estado
echo "--- 9 API: la llave de B no toca lo de A"
K=$(C -c "select id from tag where name='comedia'")
for b in "{\"action\":\"delete\",\"tagId\":$K}" "{\"action\":\"rename\",\"tagId\":$K,\"name\":\"robada\"}" "{\"action\":\"unlink\",\"seriesId\":7,\"tagId\":$K}"; do curl -s -m 8 -o /dev/null -w '  %{http_code}' -H "x-api-key: $LLAVE_B" -H 'content-type: application/json' -d "$b" "$A"; done; echo; sleep 1 2>/dev/null; estado
echo "--- 10 sin llave y con datos malos"; curl -s -m 8 -o /dev/null -w '  %{http_code}' -H 'content-type: application/json' -d '{"action":"delete","tagId":1}' "$A"; curl -s -m 8 -o /dev/null -w '  %{http_code}' -H "x-api-key: $LLAVE_A" -H 'content-type: application/json' -d '{"action":"link","seriesId":"x","name":"a"}' "$A"; curl -s -m 8 -o /dev/null -w '  %{http_code}\n' -H "x-api-key: $LLAVE_A" -H 'content-type: application/json' -d '{"action":"nada"}' "$A"
echo "--- 11 Electric caído: se guarda en Seilide, y avisa de que no ha llegado"; docker compose stop electric >/dev/null 2>&1; t0=$(date +%s%N); accion 'series/7?/addTag' name=sin-electric; echo "  tardó $(( ($(date +%s%N)-t0)/1000000 )) ms"; estado
docker compose start electric >/dev/null 2>&1; for _ in $(seq 1 60); do [[ -n $(C -c "select 1 from tag where name='sin-electric'") ]] && break; sleep 0.5 2>/dev/null; done; echo "  al volver:"; estado
echo "--- 12 Seilide caído: mensaje en el formulario, y la ficha se sigue viendo"
pid=$(cat .datos/pids/seilide); tr '\0' '\n' </proc/$pid/environ >.datos/seilide.environ; kill -9 "$pid"; sleep 1 2>/dev/null
accion 'series/7?/addTag' name=sin-seilide; accion 'library/etiquetas?/delete' tagId=$K
curl -s -m 10 -o /dev/null -b $J -w '  ficha: %{http_code}' "$B/series/7"; curl -s -m 10 -o /dev/null -b $J -w '  gestión: %{http_code}\n' "$B/library/etiquetas"; estado
env -i $(grep -E '^(PATH|HOME|PILOTO_ELECTRIC|HOST|PORT|DATABASE_URL|ORIGIN|BETTER_AUTH_SECRET|S3_[A-Z_]*|ELECTRIC_URL|ELECTRIC_SECRET)=' .datos/seilide.environ) setsid nohup bun --no-env-file ../nube/build/index.js >>.datos/seilide.log 2>&1 </dev/null &
echo $! >.datos/pids/seilide; disown; sleep 3 2>/dev/null
echo "--- 13 tiempos de vuelta (casa.log)"; grep -oE 'aquí en [0-9]+ ms' .datos/casa.log | awk '{print $3}' | sort -n | awk '{a[NR]=$1} END {print "  n="NR, "mediana="a[int((NR+1)/2)]" ms", "máx="a[NR]" ms"}'
