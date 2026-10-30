#!/usr/bin/env bash
# Baraka Order load test runner. STAGING ONLY: never point this at production.
#
#   loadtest/run.sh 100          # one run at PEAK=100
#   loadtest/run.sh 100 500 1000 # stepped series, cool-down between runs
#
# Env (defaults = local Supabase from `npx supabase start` + `next start` on :3000):
#   BASE_URL, SUPABASE_URL, ANON_KEY, SERVICE_ROLE_KEY, DB_URL, STAGE (seconds per ramp step, default 60)
#   ALLOW_REMOTE_STAGING=1 to target a non-local staging deployment you own (never production)
set -euo pipefail
cd "$(dirname "$0")"
BASE_URL=${BASE_URL:-http://127.0.0.1:3000}
SUPABASE_URL=${SUPABASE_URL:-http://127.0.0.1:54321}
DB_URL=${DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}
STAGE=${STAGE:-60}
: "${ANON_KEY:?set ANON_KEY (npx supabase status -o env)}"
: "${SERVICE_ROLE_KEY:?set SERVICE_ROLE_KEY}"

for u in "$BASE_URL" "$SUPABASE_URL" "$DB_URL"; do
  if ! echo "$u" | grep -Eq '(127\.0\.0\.1|localhost)' && [ "${ALLOW_REMOTE_STAGING:-}" != "1" ]; then
    echo "Refusing to load-test non-local target $u. Use a dedicated staging project and ALLOW_REMOTE_STAGING=1." >&2; exit 1
  fi
done
if [ "$(psql "$DB_URL" -Atc "select count(*) from customers where name like 'Synthetic %'")" = "0" ]; then
  echo "No synthetic history found. Run: psql \"\$DB_URL\" -f loadtest/sql/synthetic_history.sql" >&2; exit 1
fi

# pre-flight: the app and Supabase must answer before anything is measured
curl -sf -o /dev/null "$BASE_URL/" || { echo "App not reachable at $BASE_URL (start it: loadtest/scripts/app.sh start)" >&2; exit 1; }
curl -sf -o /dev/null -H "apikey: $ANON_KEY" "$SUPABASE_URL/rest/v1/branches?select=id&limit=1" || { echo "Supabase REST not reachable at $SUPABASE_URL" >&2; exit 1; }

OUT=results/$(date +%Y%m%d-%H%M%S); mkdir -p "$OUT"
RIDER_IDS=$(psql "$DB_URL" -Atc "select string_agg(r.id::text, ',' order by b.sort) from branches b join riders r on r.phone = '0100000' || lpad(b.sort::text, 2, '0') || '01'")
ADMIN_COOKIE=$(NEXT_PUBLIC_SUPABASE_URL=$SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY=$ANON_KEY SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY \
  node --preserve-symlinks scripts/staff-session.mjs)

for PEAK in "$@"; do
  RUN_ID=$(( $(date +%s) % 100000 ))
  echo "=== PEAK=$PEAK RUN_ID=$RUN_ID -> $OUT"
  # unlock branch PINs/riders in case an earlier run tripped a lockout; reset query stats
  psql "$DB_URL" -qc "update branch_pins set failed_attempts=0, locked_until=null; update riders set failed_attempts=0, locked_until=null; select extensions.pg_stat_statements_reset();" >/dev/null
  DB_URL=$DB_URL scripts/monitor.sh "$OUT/monitor-$PEAK.csv" 5 & MON=$!
  k6 run --quiet -e PEAK="$PEAK" -e STAGE="$STAGE" -e RUN_ID="$RUN_ID" -e BASE_URL="$BASE_URL" -e SUPABASE_URL="$SUPABASE_URL" \
    -e ANON_KEY="$ANON_KEY" -e RIDER_IDS="$RIDER_IDS" -e ADMIN_COOKIE="$ADMIN_COOKIE" -e OUT_DIR="$OUT" \
    --out csv="$OUT/k6-$PEAK.csv.gz" k6/baraka.js 2>&1 | tee "$OUT/k6-$PEAK.log" || true
  kill $MON 2>/dev/null || true
  psql "$DB_URL" -P pager=off -f sql/top_queries.sql > "$OUT/top-queries-$PEAK.txt"
  psql "$DB_URL" -P pager=off -v run="$RUN_ID" -f sql/integrity.sql > "$OUT/integrity-$PEAK.txt"
  cat "$OUT/integrity-$PEAK.txt"
  # drain: let kitchens finish, then move leftovers out of the active board so the next run starts clean
  psql "$DB_URL" -qc "update orders set status='collected' where customer_name like 'LT% Customer' and status in ('received','preparing','ready','out_for_delivery')" >/dev/null
  sleep 30
done
node scripts/report.mjs "$OUT" > "$OUT/report.md" && echo "Report: $OUT/report.md"
