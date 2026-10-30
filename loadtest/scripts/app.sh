#!/usr/bin/env bash
# Start/stop the production build of the app against the local Supabase for load testing.
#   loadtest/scripts/app.sh start|stop|restart     (build first with `npx next build` using the same env)
set -euo pipefail
# APP_DIR: run another checkout/build (e.g. a candidate fix) with the same tooling
ROOT=$(cd "$(dirname "$0")/../.." && pwd); cd "${APP_DIR:-$ROOT}"
PIDFILE=/tmp/baraka-loadtest-next.pid; LOG=${APP_LOG:-/tmp/baraka-loadtest-next.log}
stop() { [ -f "$PIDFILE" ] && kill "$(cat "$PIDFILE")" 2>/dev/null || true; rm -f "$PIDFILE"
  # next start forks a next-server child; match it by its exact process title
  for p in $(ps -eo pid=,args= | awk '$2=="next-server"{print $1}'); do kill "$p"; done; }
start() {
  eval "$(cd "$ROOT" && npx supabase status -o env 2>/dev/null | grep -E '^(ANON_KEY|SERVICE_ROLE_KEY)=')"
  NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=$ANON_KEY SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY \
    NODE_ENV=production nohup npx next start -p 3000 > "$LOG" 2>&1 & echo $! > "$PIDFILE"
  for _ in $(seq 60); do curl -sf -o /dev/null http://127.0.0.1:3000/ && { echo "app up (log $LOG)"; return; }; sleep 1; done
  echo "app did not start; see $LOG" >&2; exit 1; }
case "${1:-}" in start) start;; stop) stop;; restart) stop; sleep 2; start;; *) echo "usage: $0 start|stop|restart"; exit 1;; esac
