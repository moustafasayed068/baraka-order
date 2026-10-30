-- Post-run consistency checks for one load-test run. Usage: psql "$DB_URL" -v run=<RUN_ID> -f integrity.sql
\set name 'LT' :run ' Customer'
select 'orders in run' as check, count(*)::text as result from orders where customer_name = :'name'
union all
select 'duplicate numbers (branch, day, number)', count(*)::text from (
  select branch_id, business_date, number from orders group by 1, 2, 3 having count(*) > 1) d
union all
select 'duplicate idempotency keys', count(*)::text from (select idempotency_key from orders group by 1 having count(*) > 1) d
union all
select 'orders without items', count(*)::text from orders o where customer_name = :'name'
  and not exists (select 1 from order_items i where i.order_id = o.id)
union all
select 'subtotal <> sum(lines)', count(*)::text from orders o where customer_name = :'name'
  and o.subtotal <> (select coalesce(sum(line_total), 0) from order_items i where i.order_id = o.id)
union all
select 'total <> subtotal + fee', count(*)::text from orders where customer_name = :'name' and total <> subtotal + delivery_fee
union all
select 'number gaps today (should be 0)', coalesce(sum(gap), 0)::text from (
  select branch_id, max(number) - 100 - count(*) as gap from orders where business_date = business_date() group by 1) g
union all
select 'status timestamps out of order', count(*)::text from orders where customer_name = :'name'
  and ((ready_at < preparing_at) or (collected_at < ready_at) or (delivered_at < picked_up_at))
union all
select 'by status: ' || status, count(*)::text from orders where customer_name = :'name' group by status;
