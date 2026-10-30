-- Query plans for the two slowest admin reads, run AS the owner through RLS (the way the app runs them).
-- Usage (staging, after a load run so it doesn't skew results):  psql "$DB_URL" -f loadtest/sql/explain_admin.sql
-- Needs the synthetic owner created by loadtest/scripts/staff-session.mjs.
\set ON_ERROR_STOP 1
select user_id as owner from staff where name = 'Load test owner' limit 1 \gset
begin;
select set_config('request.jwt.claims', json_build_object('sub', :'owner', 'role', 'authenticated', 'aal', 'aal2')::text, true) \g /dev/null
select set_config('request.jwt.claim.sub', :'owner', true) \g /dev/null
set local role authenticated;
\echo '=== dashboard(): owner, all branches, last 7 business days'
explain (analyze, buffers, timing off, summary on)
  select dashboard(null, business_date() - 6, business_date());
\echo '=== admin orders list: owner, today, newest 200 (what /admin/orders sends to PostgREST)'
explain (analyze, buffers, timing off, summary on)
  select id, number, created_at, status, total from orders
  where business_date = business_date() order by created_at desc limit 200;
\echo '=== same list with order_items embedded (RLS on order_items runs per row)'
explain (analyze, buffers, timing off, summary on)
  select o.id, (select json_agg(i) from order_items i where i.order_id = o.id) from orders o
  where o.business_date = business_date() order by o.created_at desc limit 200;
rollback;
