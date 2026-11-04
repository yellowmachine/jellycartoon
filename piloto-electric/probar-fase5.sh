#!/usr/bin/env bash
# La fase 5 del piloto (#394), por partes: ./probar-fase5.sh peque|esquema|wal|proxy|corte|llave
# Con ./arrancar.sh en marcha.
cd "$(dirname "$0")"; source .datos/llaves.env
Q() { docker exec -i piloto-electric-seilide-db-1 psql -U nube -d nube -Atq "$@"; }
C() { docker exec -i piloto-electric-casa-db-1 psql -U jellycartoon -d jellycartoon -Atq "$@"; }
copia() { echo "tag[$(C -c "select string_agg(id||'='||name, ', ' order by id) from tag")] series[$(C -c "select string_agg(series_id||'/'||tag_id, ', ' order by 1,2) from series_tag")]"; }
cargas() { grep -c 'copia completa' .datos/casa.log; }
posicion() { C -c 'select shape||"="||"offset" from replica_state order by 1' 2>/dev/null | tr '\n' ' '; }
hasta() { # segundos condición-sql
  local t0=$(date +%s%N); for _ in $(seq 1 $(($1*5))); do [[ $(C -c "$2") == t ]] && { echo "  llegó en $(( ($(date +%s%N)-t0)/1000000 )) ms"; return 0; }; sleep 0.2 2>/dev/null; done; echo "  NO LLEGÓ en $1 s: $(copia)"; return 1; }
# Lo que ve un peque: kids.ts, seriesTagged.
PEQUE="select coalesce(string_agg(s.id::text, ',' order by s.id),'nada') from series s where exists (select 1 from series_tag st join tag t on t.id=st.tag_id where st.series_id=s.id and t.name='infantil')"
muestrear() { for _ in $(seq 1 "$1"); do C -c "$PEQUE"; sleep 0.05 2>/dev/null; done | sort | uniq -c >.datos/muestras; }
base() {
  C <<'SQL' >/dev/null
insert into series (id,folder,title) values (7,'siete','Siete'),(8,'ocho','Ocho') on conflict do nothing;
SQL
  Q <<SQL
delete from tag where family_id='$FAMILIA_A';
insert into tag (id,family_id,name) values (301,'$FAMILIA_A','infantil'),(302,'$FAMILIA_A','adultos');
insert into series_tag (family_id,series_id,tag_id) values ('$FAMILIA_A',7,301),('$FAMILIA_A',8,302);
SQL
  hasta 15 "select exists(select 1 from series_tag where series_id=7 and tag_id=301) and exists(select 1 from series_tag where series_id=8 and tag_id=302) and (select count(*) from tag)=2"
}
sin_electric() { docker compose stop electric >/dev/null 2>&1; docker compose rm -f electric >/dev/null 2>&1; docker volume rm piloto-electric_electric-data >/dev/null; }

# La casa de nuevo, con el mismo entorno.
reiniciar_casa() {
  local pid; pid=$(cat .datos/pids/casa); tr '\0' '\n' </proc/$pid/environ >.datos/casa.environ; kill -9 "$pid"
  env -i $(grep -E '^(PATH|HOME|PILOTO_ELECTRIC|HOST|PORT|DATABASE_URL|ORIGIN|BETTER_AUTH_SECRET|MEDIA_DIR|DATA_DIR|CINEMA_DIR|MUSIC_DIR|GAMES_DIR|DELETE_SOURCES|ELECTRIC_REPLICA)=' .datos/casa.environ) setsid nohup bun --no-env-file ../build/index.js >>.datos/casa.log 2>&1 </dev/null &
  echo $! >.datos/pids/casa; disown
}
url_seilide() { C -c "update app_setting set value='$1' where key='nube_url'"; reiniciar_casa; }
SIG=900
case $1 in
peque)
  base
  echo "--- recarga entera: la serie 8 nunca debe aparecer, y la 7 no desaparecer"
  n=$(cargas); muestrear 300 & m=$!
  sin_electric; docker compose up -d electric >/dev/null 2>&1
  wait $m; sed 's/^/   /' .datos/muestras; for _ in $(seq 1 75); do [[ $(cargas) -ge $((n+2)) ]] && break; sleep 0.2 2>/dev/null; done; echo "  cargas desde cero: $(( $(cargas)-n ))"; copia
  echo "--- le quitan a la 7 y le ponen a la 8, en la misma transacción; las dos llegan a la vez"
  muestrear 60 & m=$!
  Q -c "begin; delete from series_tag where series_id=7 and tag_id=301; insert into series_tag values ('$FAMILIA_A',8,301); commit"
  wait $m; sed 's/^/   /' .datos/muestras
  echo "--- primero el enlace, y la etiqueta nueva después: sin ella, no se ve"
  C -c "delete from replica_state where false"; muestrear 40 & m=$!
  Q -c "begin; insert into tag (id,family_id,name) values (303,'$FAMILIA_A','para-todos'); insert into series_tag values ('$FAMILIA_A',7,303); commit"
  wait $m; sed 's/^/   /' .datos/muestras
  ;;
esquema)
  base
  n=$(cargas); echo "--- añadir una columna, y esperar 90 s (revisa cada 60 s, según su guía)"
  Q -c "alter table tag add column piloto text"; sleep 90 2>/dev/null; echo "  cargas desde cero: $(( $(cargas)-n ))"
  Q -c "update tag set piloto='x' where id=301"; Q -c "insert into tag (id,family_id,name,piloto) values (311,'$FAMILIA_A','tras-columna','y')"; hasta 15 "select exists(select 1 from tag where id=311)"
  echo "--- quitar esa columna, sin usarla la casa, y esperar 90 s"
  n=$(cargas); Q -c "alter table tag drop column piloto"; sleep 90 2>/dev/null; echo "  cargas desde cero: $(( $(cargas)-n ))"
  Q -c "insert into tag (id,family_id,name) values (312,'$FAMILIA_A','tras-quitar')"; hasta 15 "select exists(select 1 from tag where id=312)"
  echo "--- renombrar una columna que la casa sí usa (migración mal hecha), 75 s"
  n=$(cargas); Q -c "alter table tag rename column name to nombre"; sleep 75 2>/dev/null
  curl -s -m 8 -o /dev/null -w '  ruta, carga inicial: %{http_code}\n' -H "x-api-key: $LLAVE_A" "http://127.0.0.1:3470/api/casa/sync/tag?offset=-1"
  curl -s -m 8 -H "x-api-key: $LLAVE_A" "http://127.0.0.1:3470/api/casa/sync/tag?offset=-1" | cut -c1-170; echo
  echo "  la copia se sigue leyendo: $(copia)"; echo "  cargas: $(( $(cargas)-n ))"
  Q -c "alter table tag rename column nombre to name"; Q -c "insert into tag (id,family_id,name) values (313,'$FAMILIA_A','tras-renombrar')"
  hasta 90 "select exists(select 1 from tag where id=313)"; copia; echo "  cargas: $(( $(cargas)-n ))"
  ;;
wal)
  base
  echo "--- Electric parado, y mucho que escribir (max_slot_wal_keep_size = 1 GB)"
  docker compose stop electric >/dev/null 2>&1; sleep 1 2>/dev/null
  wal() { Q -c "select pg_size_pretty(sum(size)) from pg_ls_waldir()"; }
  ranura() { Q -c "select slot_name, active, wal_status, pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) from pg_replication_slots"; }
  echo "  al parar: wal $(wal) · $(ranura)"
  Q -c "insert into tag (id,family_id,name) values (321,'$FAMILIA_A','durante-parada')"
  Q -c "create table relleno as select g, repeat(md5(g::text), 40) d from generate_series(1, 1000000) g"
  for i in 1 2 3; do Q -c "update relleno set g=g"; Q -c "checkpoint"; echo "  vuelta $i: wal $(wal) · $(ranura)"; done
  Q -c "drop table relleno"; Q -c "checkpoint"; Q -c "checkpoint"; echo "  tras limpiar: wal $(wal) · $(ranura)"
  n=$(cargas); echo "--- vuelve Electric"; docker compose start electric >/dev/null 2>&1
  hasta 90 "select exists(select 1 from tag where id=321)"; sleep 5 2>/dev/null; echo "  cargas desde cero: $(( $(cargas)-n )) · $(ranura)"; docker compose ps electric --format '{{.State}} {{.Status}}'; copia
  Q -c "insert into tag (id,family_id,name) values (322,'$FAMILIA_A','tras-volver')"; hasta 15 "select exists(select 1 from tag where id=322)"
  docker compose logs electric --since 3m --no-log-prefix 2>/dev/null | grep -iE 'slot|invalid|purg|error' | cut -c1-150 | tail -6
  ;;
proxy)
  base; docker compose --profile proxies up -d caddy traefik 2>&1 | grep -iE 'error|pull' | head -3
  sleep 3 2>/dev/null
  for p in "caddy 5443" "traefik 5444"; do set -- $p; SIG=$((SIG+10))
    echo "--- $1, con compresión"; url_seilide "http://127.0.0.1:$2"; sleep 5 2>/dev/null
    curl -s -m 8 -o /dev/null -D - -H 'accept-encoding: gzip' -H "x-api-key: $LLAVE_A" "http://127.0.0.1:$2/api/casa/sync/tag?offset=-1" | grep -iE '^(HTTP|content-encoding|electric-offset|cache-control)' | tr -d '\r' | tr '\n' ' ' | cut -c1-130; echo
    Q -c "insert into tag (id,family_id,name) values ($SIG,'$FAMILIA_A','por-$1')"; hasta 15 "select exists(select 1 from tag where id=$SIG)"
    n=$(grep -c 'sin respuesta' .datos/casa.log); echo "  3 min sin cambios…"; sleep 180 2>/dev/null
    Q -c "insert into tag (id,family_id,name) values ($((SIG+1)),'$FAMILIA_A','tras-espera-$1')"; hasta 15 "select exists(select 1 from tag where id=$((SIG+1)))"
    echo "  errores en esos 3 min: $(( $(grep -c 'sin respuesta' .datos/casa.log)-n ))"
    docker compose logs "$1" --no-log-prefix 2>/dev/null | grep -iE 'error|timeout|context canceled' | tail -2 | cut -c1-200
  done
  url_seilide http://127.0.0.1:3470; docker compose --profile proxies stop caddy traefik >/dev/null 2>&1
  ;;
corte)
  base; n=$(cargas); m=$(grep -c 'sin respuesta' .datos/casa.log)
  echo "--- Seilide caído $2 min, con cambios"; p=$(cat .datos/pids/seilide); tr '\0' '\n' </proc/$p/environ >.datos/seilide.environ; kill -9 "$p"
  Q -c "insert into tag (id,family_id,name) values (331,'$FAMILIA_A','durante-corte')"; sleep $(( $2*60 )) 2>/dev/null
  echo "  durante: $(copia)"
  env -i $(grep -E '^(PATH|HOME|PILOTO_ELECTRIC|HOST|PORT|DATABASE_URL|ORIGIN|BETTER_AUTH_SECRET|S3_[A-Z_]*|ELECTRIC_URL|ELECTRIC_SECRET)=' .datos/seilide.environ) setsid nohup bun --no-env-file ../nube/build/index.js >>.datos/seilide.log 2>&1 </dev/null &
  echo $! >.datos/pids/seilide; disown
  hasta 120 "select exists(select 1 from tag where id=331)"; echo "  cargas desde cero: $(( $(cargas)-n )) · avisos de error: $(( $(grep -c 'sin respuesta' .datos/casa.log)-m ))"
  Q -c "insert into tag (id,family_id,name) values (332,'$FAMILIA_A','tras-corte')"; hasta 60 "select exists(select 1 from tag where id=332)"
  ;;
llave)
  base; n=$(cargas); m=$(grep -c 'sin respuesta' .datos/casa.log)
  echo "--- llave revocada $2 min"; Q -c "create table if not exists llaves_guardadas as select * from house_key where false"; Q -c "insert into llaves_guardadas select * from house_key where family_id='$FAMILIA_A'; delete from house_key where family_id='$FAMILIA_A'"
  Q -c "insert into tag (id,family_id,name) values (341,'$FAMILIA_A','revocada')"; sleep $(( $2*60 )) 2>/dev/null
  echo "  sin llave: $(copia); avisos de error: $(( $(grep -c 'sin respuesta' .datos/casa.log)-m )); reintentos: $(grep -c 'se reintenta' .datos/casa.log)"
  Q -c "insert into house_key select * from llaves_guardadas; drop table llaves_guardadas"
  hasta 120 "select exists(select 1 from tag where id=341)"; echo "  cargas desde cero: $(( $(cargas)-n ))"
  ;;
esac
