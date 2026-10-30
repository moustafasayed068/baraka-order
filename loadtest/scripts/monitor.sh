#!/usr/bin/env bash
# Samples container CPU/memory, the Next.js server and Postgres connections every INTERVAL seconds into a CSV.
# Usage: monitor.sh <out.csv> [interval]   (stop with kill)
OUT=$1; INTERVAL=${2:-5}; DB_URL=${DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}
echo "ts,component,cpu_pct,mem_mb,extra" > "$OUT"
while true; do
  ts=$(date +%s)
  docker stats --no-stream --format '{{.Name}},{{.CPUPerc}},{{.MemUsage}}' 2>/dev/null | grep supabase_ | while IFS=, read -r n c m; do
    mem=$(echo "$m" | awk '{print $1}' | sed 's/MiB//;s/GiB/*1024/;s/KiB/\/1024/' | bc 2>/dev/null)
    echo "$ts,${n#supabase_},${c%\%},$mem," >> "$OUT"
  done
  # host processes: the Next.js server and the k6 load generator (same machine, so both compete for CPU)
  for proc in next-server k6; do
    pid=$(pgrep -x "$proc" || pgrep -f "^$proc" | head -1)
    [ -n "$pid" ] && top -b -n 2 -d 1 -p "$pid" | tail -1 | awk -v ts="$ts" -v n="$proc" '{printf "%s,%s,%s,%d,\n", ts, n, $9, $6/1024}' >> "$OUT"
  done
  psql "$DB_URL" -At -F, -c "select state, count(*) from pg_stat_activity where datname='postgres' group by 1" 2>/dev/null \
    | while IFS=, read -r st n; do echo "$ts,pg_conn,,,${st:-null}=$n" >> "$OUT"; done
  psql "$DB_URL" -At -c "select count(*) from pg_stat_activity where wait_event_type='Lock'" 2>/dev/null | sed "s/^/$ts,pg_lock_waits,,,/" >> "$OUT"
  sleep "$INTERVAL"
done
