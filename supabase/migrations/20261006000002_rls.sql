-- Row Level Security: deny by default on every table, then open exactly what each role needs.
-- Customers are anonymous (role anon) and only read the public menu/branch data.
-- Orders are created by the server (service_role, bypasses RLS) after validation.

alter table branches enable row level security;
alter table categories enable row level security;
alter table menu_items enable row level security;
alter table item_options enable row level security;
alter table branch_item_status enable row level security;
alter table delivery_zones enable row level security;
alter table customers enable row level security;
alter table addresses enable row level security;
alter table staff enable row level security;
alter table riders enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;
alter table order_counters enable row level security;
alter table audit_log enable row level security;

-- Internal functions are not callable from the browser.
revoke execute on function create_order(jsonb, jsonb) from public, anon, authenticated;
revoke execute on function next_order_number(uuid) from public, anon, authenticated;

-- Staff helpers (read the caller's row in staff; never trust a role sent by the client).
create function staff_role() returns staff_role
language sql stable security definer set search_path = '' as $$
  select role from public.staff where user_id = auth.uid()
$$;
create function staff_branch() returns uuid
language sql stable security definer set search_path = '' as $$
  select branch_id from public.staff where user_id = auth.uid()
$$;
create function is_owner() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select role = 'owner' from public.staff where user_id = auth.uid()), false)
$$;
-- true for the owner, or for staff of the given branch with one of the given roles
create function staff_can(p_branch uuid, p_roles staff_role[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.staff s where s.user_id = auth.uid()
                 and (s.role = 'owner' or (s.branch_id = p_branch and s.role = any (p_roles))))
$$;

-- ---------- Public read (anon + authenticated) ----------
create policy "public read branches" on branches for select to anon, authenticated using (true);
create policy "public read categories" on categories for select to anon, authenticated using (true);
create policy "public read active items" on menu_items for select to anon, authenticated using (active or is_owner());
create policy "public read active options" on item_options for select to anon, authenticated using (active or is_owner());
create policy "public read sold out" on branch_item_status for select to anon, authenticated using (true);
create policy "public read zones" on delivery_zones for select to anon, authenticated using (active or is_owner());

-- ---------- Owner: menu is chain-wide ----------
create policy "owner writes categories" on categories for all to authenticated using (is_owner()) with check (is_owner());
create policy "owner writes items" on menu_items for all to authenticated using (is_owner()) with check (is_owner());
create policy "owner writes options" on item_options for all to authenticated using (is_owner()) with check (is_owner());
create policy "owner inserts branches" on branches for insert to authenticated with check (is_owner());
create policy "owner deletes branches" on branches for delete to authenticated using (is_owner());

-- ---------- Owner or manager of that branch ----------
create policy "manager updates own branch" on branches for update to authenticated
  using (staff_can(id, '{manager}')) with check (staff_can(id, '{manager}'));
create policy "staff toggle sold out" on branch_item_status for all to authenticated
  using (staff_can(branch_id, '{manager,kitchen}')) with check (staff_can(branch_id, '{manager,kitchen}'));
create policy "manager writes zones" on delivery_zones for all to authenticated
  using (staff_can(branch_id, '{manager}')) with check (staff_can(branch_id, '{manager}'));
create policy "manager manages riders" on riders for all to authenticated
  using (staff_can(branch_id, '{manager}')) with check (staff_can(branch_id, '{manager}'));
-- PIN hashes never leave the server.
revoke select on riders from anon, authenticated;
grant select (id, branch_id, name, phone, failed_attempts, locked_until, active) on riders to authenticated;

-- Orders: staff of the branch read them; only owner/manager update via the table directly.
-- Kitchen devices and riders go through server routes scoped to their branch / assignment.
create policy "staff read branch orders" on orders for select to authenticated
  using (staff_can(branch_id, '{manager,kitchen,cashier,callcentre}'));
create policy "manager updates branch orders" on orders for update to authenticated
  using (staff_can(branch_id, '{manager}')) with check (staff_can(branch_id, '{manager}'));
create policy "staff read order items" on order_items for select to authenticated
  using (exists (select 1 from orders o where o.id = order_id
                 and staff_can(o.branch_id, '{manager,kitchen,cashier,callcentre}')));

-- Customer data: owner, and managers for customers who ordered at their branch.
create policy "staff read customers" on customers for select to authenticated
  using (is_owner() or exists (select 1 from orders o where o.customer_id = customers.id and staff_can(o.branch_id, '{manager}')));
create policy "manager blocks customers" on customers for update to authenticated
  using (is_owner() or exists (select 1 from orders o where o.customer_id = customers.id and staff_can(o.branch_id, '{manager}')));
create policy "owner reads addresses" on addresses for select to authenticated using (is_owner());

-- Staff table: see yourself; owner sees and manages everyone.
create policy "read own staff row" on staff for select to authenticated using (user_id = auth.uid() or is_owner());
create policy "owner manages staff" on staff for all to authenticated using (is_owner()) with check (is_owner());

-- Audit log: insert-only, owner reads.
create policy "owner reads audit" on audit_log for select to authenticated using (is_owner());
revoke update, delete, truncate on audit_log from anon, authenticated;

-- Column guard: even managers cannot rewrite money or identity fields of an order.
revoke update on orders from anon, authenticated;
grant update (status, problem, rider_id, preparing_at, ready_at, picked_up_at, delivered_at, collected_at, cancelled_at)
  on orders to authenticated;
