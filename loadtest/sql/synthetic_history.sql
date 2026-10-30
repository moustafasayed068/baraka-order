-- STAGING ONLY. One year of synthetic past orders so dashboards and admin lists run against realistic table sizes.
-- Usage: psql "$DB_URL" -v days=365 -v per_day=250 -f synthetic_history.sql
-- Past business days only (today is left for the live test, so today's order numbers stay contiguous).
\set ON_ERROR_STOP 1
\if :{?days} \else \set days 365 \endif
\if :{?per_day} \else \set per_day 250 \endif
select current_database() as db, inet_server_addr() as host \gset
\echo Generating :days days x :per_day orders/day/branch into :db on :host

begin;
-- bulk insert must not fire 900k realtime messages
alter table orders disable trigger orders_broadcast;

insert into customers (phone, name)
select '015' || lpad(g::text, 8, '0'), 'Synthetic ' || g from generate_series(1, 50000) g
on conflict (phone) do nothing;

create temp table _cust as select id, phone, name, row_number() over () as rn from customers where phone like '015%';
create temp table _items as select id, name_ar, name_en, base_price, row_number() over () as rn from menu_items where active;
select count(*) as n_items from _items \gset
select count(*) as n_cust from _cust \gset

with days as (
  select business_date() - d as day from generate_series(1, :days) d
), slots as (
  select b.id as branch_id, d.day, n, (random() < 0.2) as is_delivery
  from branches b cross join days d cross join generate_series(101, 100 + :per_day) n
), ins as (
  insert into orders (branch_id, business_date, number, tracking_token, idempotency_key, type, status, customer_id,
                      customer_name, customer_phone, address, subtotal, delivery_fee, total, payment_method, payment_status,
                      created_at, preparing_at, ready_at, picked_up_at, delivered_at, collected_at, cancelled_at, source)
  select s.branch_id, s.day, s.n, encode(gen_random_bytes(16), 'hex'), gen_random_uuid(),
         case when s.is_delivery then 'delivery' else 'pickup' end::order_type,
         case when random() < 0.03 then 'cancelled' when s.is_delivery then 'delivered' else 'collected' end::order_status,
         c.id, c.name, c.phone,
         case when s.is_delivery then '{"street":"Synthetic st","building":"1","floor":"1","apartment":"1","landmark":"","lat":null,"lng":null}'::jsonb end,
         0, case when s.is_delivery then 25 else 0 end, case when s.is_delivery then 25 else 0 end, 'cash', 'unpaid',
         t.ts, t.ts + interval '2 min', t.ts + interval '14 min',
         case when s.is_delivery then t.ts + interval '18 min' end, case when s.is_delivery then t.ts + interval '40 min' end,
         case when not s.is_delivery then t.ts + interval '20 min' end, null, 'web'
  from slots s
  cross join lateral (select ((s.day + time '09:00') at time zone 'Africa/Cairo') + (random() * interval '19 hours') as ts) t
  join _cust c on c.rn = 1 + (abs(hashtext(s.branch_id::text || s.day || s.n)) % :n_cust)
  returning id, total
)
select count(*) as orders_inserted from ins;

-- 1-3 items per order, then fix subtotal/total from the items (CHECK total = subtotal + fee)
insert into order_items (order_id, item_id, name_ar, name_en, unit_price, qty, line_total)
select o.id, i.id, i.name_ar, i.name_en, i.base_price, q.qty, i.base_price * q.qty
from orders o
cross join lateral generate_series(1, 1 + (abs(hashtext(o.id::text)) % 3)) k
cross join lateral (select 1 + (abs(hashtext(o.id::text || k)) % 2) as qty) q
join _items i on i.rn = 1 + (abs(hashtext(k || o.id::text)) % :n_items)
where o.subtotal = 0 and o.customer_name like 'Synthetic %';

update orders o set subtotal = s.sub, total = s.sub + o.delivery_fee
from (select order_id, sum(line_total)::int as sub from order_items group by 1) s
where s.order_id = o.id and o.subtotal = 0 and o.customer_name like 'Synthetic %';

alter table orders enable trigger orders_broadcast;
commit;
analyze orders; analyze order_items; analyze customers;
select count(*) as orders, pg_size_pretty(pg_total_relation_size('orders')) as orders_size,
       (select pg_size_pretty(pg_total_relation_size('order_items'))) as items_size from orders;
