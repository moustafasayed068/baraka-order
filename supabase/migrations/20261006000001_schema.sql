-- El Baraka Order: core schema.
-- Prices are integer EGP. All "today" logic uses Africa/Cairo business days (see business_date()).

create type order_type as enum ('pickup', 'delivery');
create type order_status as enum ('received', 'preparing', 'ready', 'out_for_delivery', 'collected', 'delivered', 'not_collected', 'cancelled');
create type payment_method as enum ('cash', 'online');
create type payment_status as enum ('unpaid', 'paid', 'refunded');
create type staff_role as enum ('owner', 'manager', 'kitchen', 'cashier', 'callcentre');

-- Opening hours cross midnight (9 AM–4 AM), so the business day starts at 06:00 Cairo time.
create function business_date(ts timestamptz default now()) returns date
language sql stable as $$
  select ((ts at time zone 'Africa/Cairo') - interval '6 hours')::date
$$;

create table branches (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,40}$'),
  name_ar text not null,
  name_en text not null,
  city text not null check (city in ('alexandria', 'cairo')),
  address_ar text not null default '',
  address_en text not null default '',
  maps_url text,
  opens_at time not null default '09:00',
  closes_at time not null default '04:00',
  accepts_orders boolean not null default true,
  accepts_delivery boolean not null default true,
  extra_wait_min int not null default 0 check (extra_wait_min between 0 and 120),
  sort int not null default 0
);

create table categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name_ar text not null,
  name_en text not null,
  sort int not null default 0
);

create table menu_items (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references categories on delete restrict,
  slug text not null unique,
  name_ar text not null,
  name_en text not null,
  desc_ar text not null default '',
  desc_en text not null default '',
  base_price int not null check (base_price >= 0),
  photo_url text,
  is_meal boolean not null default false, -- gets the combo upsell
  active boolean not null default true,
  sort int not null default 0
);

-- One option group per item (size or sauce). If an item has options, the customer picks exactly one.
create table item_options (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references menu_items on delete cascade,
  kind text not null check (kind in ('size', 'sauce')),
  name_ar text not null,
  name_en text not null,
  price_delta int not null default 0 check (price_delta >= 0),
  active boolean not null default true,
  sort int not null default 0
);
create index on item_options (item_id);

create table branch_item_status (
  branch_id uuid not null references branches on delete cascade,
  item_id uuid not null references menu_items on delete cascade,
  sold_out boolean not null default false,
  primary key (branch_id, item_id)
);

create table delivery_zones (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references branches on delete cascade,
  name_ar text not null,
  name_en text not null,
  fee int not null check (fee >= 0),
  min_order int not null default 0 check (min_order >= 0),
  is_sample boolean not null default false, -- seed placeholder until the owner enters real zones
  polygon jsonb,
  active boolean not null default true
);
create index on delivery_zones (branch_id);

create table customers (
  id uuid primary key default gen_random_uuid(),
  phone text not null unique check (phone ~ '^01[0125][0-9]{8}$'),
  name text not null,
  verified_at timestamptz,
  blocked boolean not null default false,
  created_at timestamptz not null default now()
);

create table addresses (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers on delete cascade,
  zone_id uuid references delivery_zones on delete set null,
  street text not null,
  building text not null default '',
  floor text not null default '',
  apartment text not null default '',
  landmark text not null default '',
  lat double precision,
  lng double precision,
  last_used_at timestamptz not null default now()
);

create table staff (
  user_id uuid primary key references auth.users on delete cascade,
  role staff_role not null,
  branch_id uuid references branches on delete set null,
  name text not null,
  check (role = 'owner' or branch_id is not null)
);

create table riders (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references branches on delete restrict,
  name text not null,
  phone text not null unique check (phone ~ '^01[0125][0-9]{8}$'),
  pin_hash text not null,
  failed_attempts int not null default 0,
  locked_until timestamptz,
  active boolean not null default true
);

create table orders (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references branches on delete restrict,
  business_date date not null default business_date(),
  number int not null,
  tracking_token text not null unique check (length(tracking_token) = 32),
  idempotency_key uuid not null unique,
  type order_type not null,
  status order_status not null default 'received',
  customer_id uuid not null references customers on delete restrict,
  customer_name text not null,
  customer_phone text not null,
  address jsonb,
  zone_id uuid references delivery_zones on delete set null,
  subtotal int not null check (subtotal >= 0),
  delivery_fee int not null default 0 check (delivery_fee >= 0),
  total int not null check (total = subtotal + delivery_fee),
  payment_method payment_method not null default 'cash',
  payment_status payment_status not null default 'unpaid',
  pickup_in_min int not null default 0 check (pickup_in_min in (0, 15, 30)),
  rider_id uuid references riders on delete set null,
  needs_call_confirm boolean not null default false,
  problem text,
  client_ip inet,
  created_at timestamptz not null default now(),
  preparing_at timestamptz,
  ready_at timestamptz,
  picked_up_at timestamptz,
  delivered_at timestamptz,
  collected_at timestamptz,
  cancelled_at timestamptz,
  unique (branch_id, business_date, number)
);
create index on orders (branch_id, status);
create index on orders (customer_phone, created_at);
create index on orders (client_ip, created_at);

create table order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders on delete cascade,
  item_id uuid not null references menu_items on delete restrict,
  option_id uuid references item_options on delete restrict,
  name_ar text not null,
  name_en text not null,
  option_ar text,
  option_en text,
  unit_price int not null check (unit_price >= 0),
  qty int not null check (qty between 1 and 20),
  line_total int not null check (line_total = unit_price * qty)
);
create index on order_items (order_id);

create table order_counters (
  branch_id uuid not null references branches on delete cascade,
  business_date date not null,
  last_number int not null,
  primary key (branch_id, business_date)
);

create table audit_log (
  id bigint generated always as identity primary key,
  actor uuid,
  action text not null,
  entity text not null,
  entity_id text,
  before jsonb,
  after jsonb,
  at timestamptz not null default now()
);

-- Daily per-branch order number starting at 101. The upsert takes a row lock,
-- so concurrent orders in the same branch/day get distinct numbers.
create function next_order_number(p_branch uuid) returns int
language sql volatile as $$
  insert into order_counters (branch_id, business_date, last_number)
  values (p_branch, business_date(), 101)
  on conflict (branch_id, business_date) do update set last_number = order_counters.last_number + 1
  returning last_number
$$;

-- Atomic order insert. Called only by the server (service_role) after it has validated
-- the request and recalculated every price from the database.
-- Returns the existing order if the idempotency key was already used.
create function create_order(p_order jsonb, p_items jsonb) returns table (tracking_token text, number int, created boolean)
language plpgsql volatile as $$
declare
  v_customer uuid;
  v_order uuid;
begin
  -- serialize retries of the same checkout so a double tap never burns an order number
  perform pg_advisory_xact_lock(hashtext(p_order->>'idempotency_key'));
  return query select o.tracking_token, o.number, false from orders o
    where o.idempotency_key = (p_order->>'idempotency_key')::uuid;
  if found then return; end if;

  insert into customers (phone, name) values (p_order->>'customer_phone', p_order->>'customer_name')
    on conflict (phone) do update set name = excluded.name
    returning id into v_customer;

  insert into orders (branch_id, number, tracking_token, idempotency_key, type, customer_id, customer_name,
                      customer_phone, address, zone_id, subtotal, delivery_fee, total, payment_method,
                      pickup_in_min, needs_call_confirm, client_ip)
  values ((p_order->>'branch_id')::uuid, next_order_number((p_order->>'branch_id')::uuid),
          encode(gen_random_bytes(16), 'hex'), (p_order->>'idempotency_key')::uuid,
          (p_order->>'type')::order_type, v_customer, p_order->>'customer_name', p_order->>'customer_phone',
          p_order->'address', (p_order->>'zone_id')::uuid, (p_order->>'subtotal')::int,
          (p_order->>'delivery_fee')::int, (p_order->>'total')::int, 'cash',
          (p_order->>'pickup_in_min')::int, coalesce((p_order->>'needs_call_confirm')::boolean, false),
          (p_order->>'client_ip')::inet)
  on conflict (idempotency_key) do nothing
  returning id into v_order;

  if v_order is null then -- lost a race with the same idempotency key
    return query select o.tracking_token, o.number, false from orders o
      where o.idempotency_key = (p_order->>'idempotency_key')::uuid;
    return;
  end if;

  insert into order_items (order_id, item_id, option_id, name_ar, name_en, option_ar, option_en, unit_price, qty, line_total)
  select v_order, (i->>'item_id')::uuid, (i->>'option_id')::uuid, i->>'name_ar', i->>'name_en',
         i->>'option_ar', i->>'option_en', (i->>'unit_price')::int, (i->>'qty')::int,
         (i->>'unit_price')::int * (i->>'qty')::int
  from jsonb_array_elements(p_items) i;

  return query select o.tracking_token, o.number, true from orders o where o.id = v_order;
end $$;

-- Stamp the time of each status change.
create function stamp_order_status() returns trigger
language plpgsql as $$
begin
  if new.status is distinct from old.status then
    case new.status
      when 'preparing' then new.preparing_at := coalesce(new.preparing_at, now());
      when 'ready' then new.ready_at := coalesce(new.ready_at, now());
      when 'out_for_delivery' then new.picked_up_at := coalesce(new.picked_up_at, now());
      when 'delivered' then new.delivered_at := coalesce(new.delivered_at, now());
      when 'collected' then new.collected_at := coalesce(new.collected_at, now());
      when 'cancelled' then new.cancelled_at := coalesce(new.cancelled_at, now());
      else null;
    end case;
  end if;
  return new;
end $$;
create trigger orders_stamp_status before update on orders for each row execute function stamp_order_status();

-- Customer live tracking: broadcast on a topic keyed by the unguessable tracking token,
-- so customers never subscribe to the orders table itself. Payload carries status only.
create function broadcast_order_status() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status is distinct from old.status then
    perform realtime.send(jsonb_build_object('status', new.status), 'status', 'order:' || new.tracking_token, false);
  end if;
  -- any status change at the branch changes "orders ahead" for everyone waiting there
  perform realtime.send(jsonb_build_object('at', now()), 'changed', 'branch:' || new.branch_id::text, false);
  return null;
end $$;
create trigger orders_broadcast after update on orders for each row execute function broadcast_order_status();
