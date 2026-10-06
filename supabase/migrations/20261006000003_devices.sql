-- Kitchen tablets and TV screens: paired once per device with the branch PIN,
-- which issues a long-lived token limited to that branch and screen type. Revoke by setting revoked_at.

create type device_kind as enum ('kitchen', 'screen');

-- Kept out of `branches` because branches is publicly readable.
create table branch_pins (
  branch_id uuid primary key references branches on delete cascade,
  pin_hash text not null, -- bcrypt via pgcrypto crypt()
  failed_attempts int not null default 0,
  locked_until timestamptz
);

create table devices (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references branches on delete cascade,
  kind device_kind not null,
  token_hash text not null unique, -- sha256 of the token; the token itself is only in the device's cookie
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

alter table branch_pins enable row level security; -- no policies: server only
alter table devices enable row level security;
create policy "manager reads branch devices" on devices for select to authenticated using (staff_can(branch_id, '{manager}'));
create policy "manager revokes branch devices" on devices for update to authenticated
  using (staff_can(branch_id, '{manager}')) with check (staff_can(branch_id, '{manager}'));
revoke update on devices from authenticated;
grant update (revoked_at) on devices to authenticated;

-- Verifies the PIN (5 wrong tries -> locked 15 min) and returns a new device token.
-- Never raises on a wrong PIN, so the failed-attempt counter is always saved.
create function pair_device(p_slug text, p_pin text, p_kind device_kind) returns table (token text, error text)
language plpgsql security definer set search_path = '' as $$
declare
  v_branch uuid;
  v_pin public.branch_pins%rowtype;
  v_token text;
begin
  select b.id into v_branch from public.branches b where b.slug = p_slug;
  select * into v_pin from public.branch_pins p where p.branch_id = v_branch for update;
  if not found then return query select null::text, 'bad_pin'::text; return; end if;
  if v_pin.locked_until > now() then return query select null::text, 'locked'::text; return; end if;

  if v_pin.pin_hash <> extensions.crypt(p_pin, v_pin.pin_hash) then
    update public.branch_pins p set
      failed_attempts = case when p.failed_attempts + 1 >= 5 then 0 else p.failed_attempts + 1 end,
      locked_until = case when p.failed_attempts + 1 >= 5 then now() + interval '15 minutes' else p.locked_until end
    where p.branch_id = v_branch;
    return query select null::text, 'bad_pin'::text;
    return;
  end if;

  update public.branch_pins p set failed_attempts = 0, locked_until = null where p.branch_id = v_branch;
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.devices (branch_id, kind, token_hash)
    values (v_branch, p_kind, encode(extensions.digest(v_token, 'sha256'), 'hex'));
  insert into public.audit_log (action, entity, entity_id, after)
    values ('device_paired', 'devices', v_branch::text, jsonb_build_object('kind', p_kind));
  return query select v_token, null::text;
end $$;
revoke execute on function pair_device(text, text, device_kind) from public, anon, authenticated;

-- Branch topic now also fires on new orders, so kitchen boards and TV screens refetch instantly.
-- Payload is only a timestamp; the data itself is fetched through authenticated server routes.
create or replace function broadcast_order_status() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    perform realtime.send(jsonb_build_object('status', new.status), 'status', 'order:' || new.tracking_token, false);
  end if;
  perform realtime.send(jsonb_build_object('at', now()), 'changed', 'branch:' || new.branch_id::text, false);
  return null;
end $$;
drop trigger orders_broadcast on orders;
create trigger orders_broadcast after insert or update on orders for each row execute function broadcast_order_status();
