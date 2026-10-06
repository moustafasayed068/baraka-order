-- Staff admin: 2FA-gated roles, automatic audit trail, PIN helpers, order source.

-- Owners and managers only get their rights after completing 2FA (session at aal2).
-- Other staff roles (kitchen, cashier, callcentre) work with a password session.
create or replace function staff_can(p_branch uuid, p_roles staff_role[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.staff s
    where s.user_id = auth.uid()
      and (s.role not in ('owner', 'manager') or coalesce(auth.jwt() ->> 'aal', '') = 'aal2')
      and (s.role = 'owner' or (s.branch_id = p_branch and s.role = any (p_roles)))
  )
$$;

create or replace function is_owner() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select role = 'owner' and coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
                   from public.staff where user_id = auth.uid()), false)
$$;

-- ---------- Audit: every staff change (never PINs). Kitchen/rider/server flows run as service_role
-- (auth.uid() is null) and are audited explicitly in their routes instead.
create function audit_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_before jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) - 'pin_hash' end;
  v_after jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) - 'pin_hash' end;
begin
  if auth.uid() is null or v_before is not distinct from v_after then return null; end if;
  insert into public.audit_log (actor, action, entity, entity_id, before, after)
  values (auth.uid(), lower(tg_op), tg_table_name, coalesce(v_after, v_before) ->> 'id', v_before, v_after);
  return null;
end $$;

create trigger audit after insert or update or delete on menu_items for each row execute function audit_row();
create trigger audit after insert or update or delete on item_options for each row execute function audit_row();
create trigger audit after insert or update or delete on categories for each row execute function audit_row();
create trigger audit after insert or update or delete on branches for each row execute function audit_row();
create trigger audit after insert or update or delete on delivery_zones for each row execute function audit_row();
create trigger audit after insert or update or delete on riders for each row execute function audit_row();
create trigger audit after insert or update or delete on staff for each row execute function audit_row();
create trigger audit after update on orders for each row execute function audit_row();
create trigger audit after update on customers for each row execute function audit_row();
create trigger audit after update on devices for each row execute function audit_row();

-- ---------- PINs are always hashed in the database, never sent back.
create function save_rider(p_id uuid, p_branch uuid, p_name text, p_phone text, p_pin text, p_active boolean) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not public.staff_can(p_branch, '{manager}') then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_pin is not null and p_pin !~ '^[0-9]{4,8}$' then raise exception 'bad_pin' using errcode = '22023'; end if;
  if p_id is null then
    if p_pin is null then raise exception 'bad_pin' using errcode = '22023'; end if;
    insert into public.riders (branch_id, name, phone, pin_hash, active)
    values (p_branch, p_name, p_phone, extensions.crypt(p_pin, extensions.gen_salt('bf')), p_active)
    returning id into v_id;
  else
    -- managers can only touch riders of their own branch (old and new branch both checked)
    if not exists (select 1 from public.riders r where r.id = p_id and public.staff_can(r.branch_id, '{manager}')) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    update public.riders set branch_id = p_branch, name = p_name, phone = p_phone, active = p_active,
      pin_hash = coalesce(extensions.crypt(p_pin, extensions.gen_salt('bf')), pin_hash),
      failed_attempts = case when p_pin is null then failed_attempts else 0 end,
      locked_until = case when p_pin is null then locked_until end
    where id = p_id returning id into v_id;
    if not p_active then update public.rider_sessions set revoked_at = now() where rider_id = p_id and revoked_at is null; end if;
  end if;
  return v_id;
end $$;

create function set_branch_pin(p_branch uuid, p_pin text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.staff_can(p_branch, '{manager}') then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_pin !~ '^[0-9]{4,8}$' then raise exception 'bad_pin' using errcode = '22023'; end if;
  insert into public.branch_pins (branch_id, pin_hash) values (p_branch, extensions.crypt(p_pin, extensions.gen_salt('bf')))
  on conflict (branch_id) do update set pin_hash = excluded.pin_hash, failed_attempts = 0, locked_until = null;
  insert into public.audit_log (actor, action, entity, entity_id) values (auth.uid(), 'branch_pin_changed', 'branches', p_branch::text);
end $$;

revoke execute on function save_rider(uuid, uuid, text, text, text, boolean) from public, anon;
revoke execute on function set_branch_pin(uuid, text) from public, anon;
grant execute on function save_rider(uuid, uuid, text, text, text, boolean) to authenticated;
grant execute on function set_branch_pin(uuid, text) to authenticated;

-- Riders are written only through save_rider (so a PIN is always hashed).
revoke insert, update, delete on riders from authenticated;

-- Managers may only flip the blocklist flag on customers.
revoke update on customers from authenticated;
grant update (blocked) on customers to authenticated;

-- Where an order came from: the customer site or a call-centre agent.
alter table orders add column source text not null default 'web' check (source in ('web', 'callcentre'));
alter table orders add column created_by uuid references auth.users on delete set null;

-- Device revocation from admin: managers set revoked_at on their branch's devices (policy from migration 3).
