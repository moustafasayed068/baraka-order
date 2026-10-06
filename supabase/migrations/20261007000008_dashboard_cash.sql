-- Dashboard summary. SECURITY INVOKER: runs with the caller's RLS, so a manager only ever
-- sees their own branch and the owner sees all. Times and hours are in Africa/Cairo.
create function dashboard(p_branch uuid, p_from date, p_to date) returns jsonb
language sql stable security invoker set search_path = public as $$
  with o as (
    select * from orders
    where business_date between p_from and p_to and (p_branch is null or branch_id = p_branch)
  ),
  live as (select * from o where status <> 'cancelled'),
  done as (select * from o where status in ('collected', 'delivered'))
  select jsonb_build_object(
    'orders', (select count(*) from live),
    'revenue', (select coalesce(sum(total), 0) from done),
    'open', (select count(*) from o where status in ('received', 'preparing', 'ready', 'out_for_delivery')),
    'cancelled', (select count(*) from o where status = 'cancelled'),
    'not_collected', (select count(*) from o where status = 'not_collected'),
    'pickup', (select count(*) from live where type = 'pickup'),
    'delivery', (select count(*) from live where type = 'delivery'),
    'avg_prep_min', (select round(avg(extract(epoch from ready_at - created_at)) / 60) from o where ready_at is not null),
    'avg_delivery_min', (select round(avg(extract(epoch from delivered_at - picked_up_at)) / 60) from o where delivered_at is not null and picked_up_at is not null),
    'best', (select coalesce(jsonb_agg(x order by x.qty desc), '[]') from (
      select i.name_ar, i.name_en, sum(i.qty)::int as qty from order_items i join live on live.id = i.order_id
      group by 1, 2 order by 3 desc limit 8) x),
    'by_hour', (select coalesce(jsonb_object_agg(x.h, x.n), '{}') from (
      select extract(hour from created_at at time zone 'Africa/Cairo')::int as h, count(*) as n from live group by 1) x),
    'by_branch', (select coalesce(jsonb_agg(x order by x.revenue desc), '[]') from (
      select b.name_ar, b.name_en, count(*) filter (where o.status <> 'cancelled') as orders,
             coalesce(sum(o.total) filter (where o.status in ('collected', 'delivered')), 0) as revenue
      from o join branches b on b.id = o.branch_id group by 1, 2) x)
  )
$$;
revoke execute on function dashboard(uuid, date, date) from public, anon;
grant execute on function dashboard(uuid, date, date) to authenticated;

-- End-of-shift cash: what the manager actually received from each rider for a business day.
-- Expected cash = the rider's delivered cash orders that day; any difference is flagged in the report.
create table rider_handovers (
  id uuid primary key default gen_random_uuid(),
  rider_id uuid not null references riders on delete restrict,
  business_date date not null,
  amount int not null check (amount >= 0),
  expected int not null check (expected >= 0),
  received_by uuid not null default auth.uid() references auth.users on delete restrict,
  at timestamptz not null default now()
);
alter table rider_handovers enable row level security;
create policy "manager reads handovers" on rider_handovers for select to authenticated
  using (exists (select 1 from riders r where r.id = rider_id and staff_can(r.branch_id, '{manager}')));
create policy "manager records handovers" on rider_handovers for insert to authenticated
  with check (received_by = auth.uid() and exists (select 1 from riders r where r.id = rider_id and staff_can(r.branch_id, '{manager}')));
revoke update, delete on rider_handovers from anon, authenticated; -- money records are insert-only
create trigger audit after insert on rider_handovers for each row execute function audit_row();
