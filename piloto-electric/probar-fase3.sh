#!/usr/bin/env bash
# La fase 3 del piloto (#394), de punta a punta. Con ./arrancar.sh en marcha.
cd "$(dirname "$0")"; source .datos/llaves.env
S=http://127.0.0.1:3470/api/casa/sync
Q() { docker exec -i piloto-electric-seilide-db-1 psql -U nube -d nube -Atq "$@"; }
C() { docker exec -i piloto-electric-casa-db-1 psql -U jellycartoon -d jellycartoon -At "$@"; }
# Todo el shape, como un cliente: de tanda en tanda hasta `up-to-date`. Tras la llave y la tabla, parámetros de más.
pedir() { python3 -I - "$S" "$@" <<'PY'
import json,sys,urllib.parse,urllib.request
base,key,table,*extra=sys.argv[1:]
offset,handle,rows,code="-1",None,[],None
for _ in range(20):
    q=[("offset",offset)]+([("handle",handle)] if handle else [])+[tuple(e.split("=",1)) for e in extra]
    r=urllib.request.urlopen(urllib.request.Request(f"{base}/{table}?"+urllib.parse.urlencode(q),headers={"x-api-key":key}),timeout=15)
    code=r.status; d=json.loads(r.read())
    rows+=[m["value"] for m in d if "value" in m]
    offset,handle=r.headers["electric-offset"],r.headers["electric-handle"]
    if r.headers.get("electric-up-to-date") is not None: break
print(code,rows)
PY
}
casa() { C -c "select string_agg(id||'='||name, ', ' order by id) from tag" ; C -c "select string_agg(series_id||'/'||tag_id, ', ' order by series_id,tag_id) from series_tag"; }
espera() { local d=$1 quiere=$2 t0=$(date +%s%N); for _ in $(seq 1 100); do [[ "$(casa | tr '\n' '|')" == "$quiere" ]] && { echo "  llegó en $(( ($(date +%s%N)-t0)/1000000 )) ms"; return 0; }; sleep 0.1 2>/dev/null; done; echo "  NO LLEGÓ en 10 s: $(casa | tr '\n' '|')"; return 1; }

Q <<SQL
delete from tag; 
insert into tag (id, family_id, name) values (101,'$FAMILIA_A','infantil'),(102,'$FAMILIA_A','comedia'),(201,'fam-b','de-b');
insert into series_tag (family_id, series_id, tag_id) values ('$FAMILIA_A',7,101),('fam-b',7,201);
SQL
echo "--- 1 la copia recibe solo lo de A"; espera x '101=infantil, 102=comedia|7/101|'
echo "--- 2 llave de B, solo lo de B"; pedir "$LLAVE_B" tag; pedir "$LLAVE_B" series_tag
echo "--- 3 sin llave y con llave falsa"; curl -s -m 8 -o /dev/null -w '%{http_code} ' "$S/tag?offset=-1"; curl -s -m 8 -o /dev/null -w '%{http_code}\n' -H 'x-api-key: nube_falsa' "$S/tag?offset=-1"
echo "--- 4 tabla fuera de la lista"; curl -s -m 8 -o /dev/null -w '%{http_code} ' -H "x-api-key: $LLAVE_A" "$S/expense?offset=-1"; curl -s -m 8 -o /dev/null -w '%{http_code}\n' -H "x-api-key: $LLAVE_A" "$S/constructor?offset=-1"
echo "--- 5 A intenta ver lo de B cambiando la petición"
pedir "$LLAVE_A" tag "where=family_id='fam-b'" 'params[1]=fam-b' 'table=series_tag' 'columns=family_id,id,name' 'secret=x' "subset__where=true" | python3 -I -c 'import sys;t=sys.stdin.read();print(t[:3], "ids:", sorted(set(__import__("re").findall(r"\x27id\x27: \x27(\d+)\x27",t))))'
echo "--- 6 cabeceras al cliente"; curl -s -m 8 -D - -o /dev/null -H "x-api-key: $LLAVE_A" "$S/tag?offset=-1" | grep -iE '^(electric-handle|electric-offset|cache-control|vary|content-encoding)' | cut -c1-70 | tr -d '\r'
echo "--- 7 en vivo: cambio, alta, baja"
Q -c "update tag set name='peques' where id=101"; espera x '101=peques, 102=comedia|7/101|'
Q -c "insert into tag (id,family_id,name) values (103,'$FAMILIA_A','nueva')"; espera x '101=peques, 102=comedia, 103=nueva|7/101|'
Q -c "delete from tag where id=102"; espera x '101=peques, 103=nueva|7/101|'
Q -c "insert into tag (id,family_id,name) values (202,'fam-b','otra-de-b')"; sleep 1 2>/dev/null; echo "  con cambio en B, la copia: $(casa | tr '\n' '|')"
echo "--- 8 borrado en cascada en Seilide"; Q -c "delete from tag where id=101"; espera x '103=nueva||' ; Q -c "insert into tag (id,family_id,name) values (101,'$FAMILIA_A','infantil'); insert into series_tag values ('$FAMILIA_A',7,101)"; espera x '101=infantil, 103=nueva|7/101|'

fila() { docker exec -i piloto-electric-casa-db-1 psql -U jellycartoon -d jellycartoon -Atc "select shape,\"offset\" from replica_state order by 1" | tr '\n' ' '; }
echo "--- 9 la casa se reinicia con cambios por medio: sigue donde quedó"
before=$(grep -c 'copia completa' .datos/casa.log); pid=$(cat .datos/pids/casa); tr '\0' '\n' </proc/$pid/environ >.datos/casa.environ; kill -9 "$pid"
Q -c "insert into tag (id,family_id,name) values (104,'$FAMILIA_A','mientras')"
env -i $(grep -E '^(PATH|HOME|PILOTO_ELECTRIC|HOST|PORT|DATABASE_URL|ORIGIN|BETTER_AUTH_SECRET|MEDIA_DIR|DATA_DIR|CINEMA_DIR|MUSIC_DIR|GAMES_DIR|DELETE_SOURCES|ELECTRIC_REPLICA)=' .datos/casa.environ) setsid nohup bun --no-env-file ../build/index.js >>.datos/casa.log 2>&1 </dev/null &
echo $! >.datos/pids/casa; disown
espera x '101=infantil, 103=nueva, 104=mientras|7/101|'; echo "  cargas desde cero nuevas: $(( $(grep -c 'copia completa' .datos/casa.log) - before ))"
echo "--- 10 Electric caído: la casa sigue leyendo, y al volver se pone al día"
docker compose stop electric >/dev/null 2>&1; sleep 2 2>/dev/null
Q -c "insert into tag (id,family_id,name) values (105,'$FAMILIA_A','sin-electric')"; sleep 2 2>/dev/null; echo "  copia: $(casa | tr '\n' '|')"; curl -s -m 8 -o /dev/null -w '  ruta: %{http_code}\n' -H "x-api-key: $LLAVE_A" "$S/tag?offset=-1"
docker compose start electric >/dev/null 2>&1; espera x '101=infantil, 103=nueva, 104=mientras, 105=sin-electric|7/101|' || { sleep 25 2>/dev/null; echo "  a los 35 s: $(casa | tr '\n' '|')"; }
echo "--- 11 cambio de esquema: Electric manda empezar de nuevo; nunca hay un momento sin etiquetas"
before=$(grep -c 'copia completa' .datos/casa.log)
muestrear() { for _ in $(seq 1 "$1"); do C -c "select count(*) from tag"; sleep 0.05 2>/dev/null; done | sort -n | uniq -c >.datos/muestras; }
muestrear 240 & m=$!
Q -c "alter table tag add column piloto text"; Q -c "insert into tag (id,family_id,name) values (106,'$FAMILIA_A','tras-esquema')"
espera x '101=infantil, 103=nueva, 104=mientras, 105=sin-electric, 106=tras-esquema|7/101|' || { sleep 60 2>/dev/null; echo "  a los 70 s: $(casa | tr '\n' '|')"; }
wait $m; echo "  filas en cada muestra (veces, filas):"; sed 's/^/   /' .datos/muestras; echo "  cargas desde cero nuevas: $(( $(grep -c 'copia completa' .datos/casa.log) - before ))"
Q -c "alter table tag drop column piloto"; sleep 3 2>/dev/null; echo "  posición: $(fila)"

echo "--- 12 Electric pierde sus shapes: empieza de nuevo sin dejar un momento vacío ni perder lo local"
docker exec -i piloto-electric-casa-db-1 psql -U jellycartoon -d jellycartoon -q >/dev/null <<SQL
insert into movie (path,title,size,mtime) values ('/piloto.mkv','piloto',1,now()) on conflict do nothing;
insert into movie_tag (movie_id,tag_id) select id,101 from movie where path='/piloto.mkv' on conflict do nothing;
SQL
before=$(grep -c 'copia completa' .datos/casa.log)
muestrear 400 & m=$!
docker compose stop electric >/dev/null 2>&1; docker compose rm -f electric >/dev/null 2>&1; docker volume rm piloto-electric_electric-data >/dev/null
Q -c "insert into tag (id,family_id,name) values (107,'$FAMILIA_A','en-el-hueco')"; Q -c "delete from tag where id=105"
docker compose up -d electric >/dev/null 2>&1
espera x '101=infantil, 103=nueva, 104=mientras, 106=tras-esquema, 107=en-el-hueco|7/101|' || { sleep 35 2>/dev/null; echo "  a los 45 s: $(casa | tr '\n' '|')"; }
wait $m; echo "  filas en cada muestra (veces, filas):"; sed 's/^/   /' .datos/muestras; echo "  cargas desde cero nuevas: $(( $(grep -c 'copia completa' .datos/casa.log) - before ))"
echo "  etiquetas de la película local: $(C -c 'select count(*) from movie_tag')"; echo "  posición: $(fila)"
