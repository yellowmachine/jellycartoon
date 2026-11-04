#!/usr/bin/env bash
# Una medición limpia (#394, fase 5): sin tablas de carga ni shapes de antes. ./medir-carga.sh tablas familias segundos
cd "$(dirname "$0")"
Q() { docker exec -i piloto-electric-seilide-db-1 psql -U nube -d nube -Atq "$@"; }
docker compose stop electric >/dev/null 2>&1; docker compose rm -f electric >/dev/null 2>&1; docker volume rm piloto-electric_electric-data >/dev/null
for t in $(Q -c "select tablename from pg_tables where tablename like 'carga\_%'"); do Q -c "drop table $t"; done
Q -c "checkpoint"
docker compose up -d --wait electric >/dev/null 2>&1; sleep 2 2>/dev/null
med() { echo "  $1: Electric $(docker stats --no-stream --format '{{.MemUsage}} {{.CPUPerc}}' piloto-electric-electric-1 | awk '{print $1,$NF}') · Postgres $(docker stats --no-stream --format '{{.MemUsage}}' piloto-electric-seilide-db-1 | awk '{print $1}') · disco $(docker exec piloto-electric-electric-1 du -sh /var/lib/electric | cut -f1)"; }
med 'en reposo'
(cd .. && exec bun --no-env-file piloto-electric/carga.ts "$@") & p=$!
for _ in 1 2 3 4 5 6 7 8; do sleep 20 2>/dev/null; kill -0 $p 2>/dev/null || break; med 'en marcha'; done
wait $p; echo "  salida: $?"; med 'al terminar'
