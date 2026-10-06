-- Riders log in with phone + PIN (bcrypt). 5 wrong tries lock the rider for 15 minutes.
-- A login issues a shift session (16 h); only the token's sha256 is stored.

create table rider_sessions (
  id uuid primary key default gen_random_uuid(),
  rider_id uuid not null references riders on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '16 hours',
  revoked_at timestamptz
);
alter table rider_sessions enable row level security; -- no policies: server only

create function rider_login(p_phone text, p_pin text) returns table (token text, error text)
language plpgsql security definer set search_path = '' as $$
declare
  v_rider public.riders%rowtype;
  v_token text;
begin
  select * into v_rider from public.riders r where r.phone = p_phone and r.active for update;
  -- same answer for unknown phone and wrong PIN, so phones can't be probed
  if not found then return query select null::text, 'bad_login'::text; return; end if;
  if v_rider.locked_until > now() then return query select null::text, 'locked'::text; return; end if;

  if v_rider.pin_hash <> extensions.crypt(p_pin, v_rider.pin_hash) then
    update public.riders r set
      failed_attempts = case when r.failed_attempts + 1 >= 5 then 0 else r.failed_attempts + 1 end,
      locked_until = case when r.failed_attempts + 1 >= 5 then now() + interval '15 minutes' else r.locked_until end
    where r.id = v_rider.id;
    return query select null::text, 'bad_login'::text;
    return;
  end if;

  update public.riders r set failed_attempts = 0, locked_until = null where r.id = v_rider.id;
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.rider_sessions (rider_id, token_hash) values (v_rider.id, encode(extensions.digest(v_token, 'sha256'), 'hex'));
  insert into public.audit_log (action, entity, entity_id) values ('rider_login', 'riders', v_rider.id::text);
  return query select v_token, null::text;
end $$;
revoke execute on function rider_login(text, text) from public, anon, authenticated;

create index on orders (rider_id, status);
