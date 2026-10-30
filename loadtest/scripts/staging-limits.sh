#!/usr/bin/env bash
# Make a LOCAL Supabase stack behave like a hosted paid project for load testing. Run after `npx supabase start`
# (and again after any restart: the Kong change does not survive a container restart).
#  - Kong: the local gateway ships with 1 worker x 512 connections. Every open Realtime WebSocket and every
#    app->Supabase request holds one, so ~250 tracking pages exhaust it and ALL API calls fail. Hosted Supabase has
#    no such limit, so we lift it to measure the app instead of the local gateway.
#  - Realtime: the local tenant has Free-plan quotas (200 concurrent connections, 100 events/s). We set the Pro
#    quotas (500 / 500). Set RT_USERS / RT_EVENTS to model another plan.
set -euo pipefail
RT_USERS=${RT_USERS:-500}; RT_EVENTS=${RT_EVENTS:-500}
docker exec supabase_kong_baraka-order sh -c 'KONG_NGINX_EVENTS_WORKER_CONNECTIONS=16384 kong reload' >/dev/null
docker exec supabase_kong_baraka-order grep -q "worker_connections 16384" /usr/local/kong/nginx.conf && echo "kong: 16384 connections"
psql "postgresql://supabase_admin:postgres@127.0.0.1:54322/postgres" -qc \
  "update _realtime.tenants set max_concurrent_users=$RT_USERS, max_events_per_second=$RT_EVENTS, max_joins_per_second=$RT_EVENTS where external_id='realtime-dev'"
docker restart supabase_realtime_baraka-order >/dev/null && echo "realtime: $RT_USERS concurrent, $RT_EVENTS events/s"
