# Load and performance tests

k6 scripts that simulate customers, kitchen tablets, TV screens, riders, the owner's dashboard and open tracking
pages (Supabase Realtime) at the same time, then check the database for duplicate or inconsistent orders.

**Staging only.** Never run this against production. `run.sh` and `staff-session.mjs` refuse any target that isn't
`localhost`/`127.0.0.1` unless you set `ALLOW_REMOTE_STAGING=1`, which you should do only for a dedicated staging
Supabase project and Vercel preview that hold synthetic data.

## What it simulates

| Scenario | VUs | Behaviour |
|---|---|---|
| customers | ramps 25% → 50% → 100% of `PEAK`, holds, ramps down | home page → branch menu → reads 5–15 s → 35% place an order (25% delivery, 5% double-tap) → open the tracking page and poll every 10 s, 2–6 times |
| kitchen | 10 (one per branch) | refresh board every 3 s, move up to 6 tickets forward (start → ready → collected / assign rider) |
| screens | 10 | TV refresh every 5 s |
| riders | 10 | refresh, picked up → delivered |
| staff | 5 | owner dashboard (today / week) and orders list through the real admin pages, signed in with password + TOTP |
| realtime | 50% of the customer VUs | open tracking pages: WebSocket join to the branch topic, ~1 minute each; measures broadcast latency (DB `now()` → client) |

Every synthetic order uses a unique phone and the name `LT<RUN_ID> Customer`, so `sql/integrity.sql` can check exactly
that run's orders. k6 sends a synthetic `X-Forwarded-For` per VU, because all traffic comes from one machine and the
20-orders-per-IP limit would otherwise reject it (this relies on audit finding F-16 and works only off Vercel).

## Run it locally

```bash
# 1. Local Supabase (Docker) with the real migrations + dev seed
npx supabase start
eval "$(npx supabase status -o env | grep -E '^(ANON_KEY|SERVICE_ROLE_KEY|DB_URL)=')"
export ANON_KEY SERVICE_ROLE_KEY DB_URL

# 2. One year of synthetic history (~912k orders, ~5 min) so queries run against realistic table sizes
psql "$DB_URL" -v days=365 -v per_day=250 -f loadtest/sql/synthetic_history.sql

# 3. Production build of the app pointed at the local stack
export NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=$ANON_KEY SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY
npx next build && npx next start -p 3000 &

# 4. Stepped series (each step ramps over 3 × STAGE seconds, holds 3 × STAGE, ramps down)
loadtest/run.sh 100 500 1000          # STAGE=60 by default; STAGE=30 for a quicker pass
```

Branches must be open (09:00–04:00 Cairo) while the test runs, or every order is rejected with `closed`.

## Output (`loadtest/results/<timestamp>/`)

| File | Contents |
|---|---|
| `report.md` | Per step: req/s, p50/p95/p99 per endpoint, 30-second timeline, CPU per component, Postgres connections, Realtime latency, integrity results, heaviest queries |
| `k6-<peak>.csv.gz`, `summary-<peak>.json` | Raw k6 samples and summary |
| `monitor-<peak>.csv` | CPU/memory of each Supabase container, the Next.js server and k6; Postgres connections and lock waits every 5 s |
| `integrity-<peak>.txt` | Duplicate numbers or idempotency keys, orders without items, wrong totals, number gaps, status timestamps |
| `top-queries-<peak>.txt` | `pg_stat_statements` top 20 by total time |

## Against a hosted staging project

Use a separate Supabase project (same plan size as production) and a Vercel preview deployment with synthetic data:
set `BASE_URL`, `SUPABASE_URL`, `ANON_KEY`, `SERVICE_ROLE_KEY`, `DB_URL` and `ALLOW_REMOTE_STAGING=1`. On Vercel the
synthetic `X-Forwarded-For` is ignored, so raise the per-IP limit on staging or run k6 from several machines.
Database CPU there comes from the Supabase dashboard instead of `docker stats`.

## Cleaning up

Synthetic orders are tagged: `delete from orders where customer_name like 'LT% Customer' or customer_name like 'Synthetic %';`
or simply `npx supabase db reset` for a local stack.
