-- Online payment (Paymob). Server-only: orders become paid ONLY from the HMAC-verified webhook, never from the browser.

alter table orders add column if not exists payment_ref text;        -- Paymob's order id for this checkout
alter table orders add column if not exists paid_at timestamptz;
create index if not exists orders_payment_ref on orders (payment_ref);

-- Every webhook call is logged; a transaction id is processed once.
create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders on delete set null,
  provider text not null default 'paymob',
  transaction_id text not null unique,
  amount_cents int not null,
  currency text not null,
  success boolean not null,
  raw jsonb not null,
  created_at timestamptz not null default now()
);
alter table payments enable row level security; -- no policies: only the service role touches it

-- create_order: same body as before, plus payment_method. Online orders start in awaiting_payment.
create or replace function create_order(p_order jsonb, p_items jsonb) returns table (tracking_token text, number int, created boolean)
language plpgsql volatile as $$
declare
  v_customer uuid;
  v_order uuid;
  v_method payment_method := coalesce(p_order->>'payment_method', 'cash')::payment_method;
begin
  perform pg_advisory_xact_lock(hashtext(p_order->>'idempotency_key'));
  return query select o.tracking_token, o.number, false from orders o
    where o.idempotency_key = (p_order->>'idempotency_key')::uuid;
  if found then return; end if;

  insert into customers (phone, name) values (p_order->>'customer_phone', p_order->>'customer_name')
    on conflict (phone) do update set name = excluded.name
    returning id into v_customer;

  insert into orders (branch_id, number, tracking_token, idempotency_key, type, status, customer_id, customer_name,
                      customer_phone, address, zone_id, subtotal, delivery_fee, total, payment_method,
                      pickup_in_min, needs_call_confirm, client_ip, source, created_by)
  values ((p_order->>'branch_id')::uuid, next_order_number((p_order->>'branch_id')::uuid),
          encode(gen_random_bytes(16), 'hex'), (p_order->>'idempotency_key')::uuid,
          (p_order->>'type')::order_type,
          (case when v_method = 'online' then 'awaiting_payment' else 'received' end)::order_status,
          v_customer, p_order->>'customer_name', p_order->>'customer_phone',
          p_order->'address', (p_order->>'zone_id')::uuid, (p_order->>'subtotal')::int,
          (p_order->>'delivery_fee')::int, (p_order->>'total')::int, v_method,
          (p_order->>'pickup_in_min')::int, coalesce((p_order->>'needs_call_confirm')::boolean, false),
          (p_order->>'client_ip')::inet, coalesce(p_order->>'source', 'web'), (p_order->>'created_by')::uuid)
  on conflict (idempotency_key) do nothing
  returning id into v_order;

  if v_order is null then
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

-- Webhook: log the transaction once; on a successful payment for the right amount, release the order to the kitchen.
-- Returns 'paid', 'duplicate', 'failed', 'mismatch' or 'unknown_order'.
create or replace function record_payment(p_ref text, p_merchant_ref text, p_txn text, p_amount_cents int,
                                          p_currency text, p_success boolean, p_raw jsonb) returns text
language plpgsql volatile as $$
declare
  v_order orders%rowtype;
begin
  select * into v_order from orders
    where (p_merchant_ref ~ '^[0-9a-f-]{36}$' and id = p_merchant_ref::uuid) or (p_ref is not null and payment_ref = p_ref)
    limit 1 for update;

  insert into payments (order_id, transaction_id, amount_cents, currency, success, raw)
    values (v_order.id, p_txn, p_amount_cents, p_currency, p_success, p_raw)
    on conflict (transaction_id) do nothing;
  if not found then return 'duplicate'; end if;
  if v_order.id is null then return 'unknown_order'; end if;
  if not p_success then return 'failed'; end if;
  if p_currency <> 'EGP' or p_amount_cents <> v_order.total * 100 then return 'mismatch'; end if;
  if v_order.payment_status = 'paid' then return 'duplicate'; end if;

  -- paid after it expired: still honour it (money was taken), the kitchen gets it now
  update orders set payment_status = 'paid', paid_at = now(),
    status = case when status in ('awaiting_payment', 'cancelled') then 'received'::order_status else status end,
    cancelled_at = case when status = 'cancelled' then null else cancelled_at end
    where id = v_order.id;
  return 'paid';
end $$;

-- Unpaid online orders expire after 15 minutes and never reach the kitchen.
create or replace function expire_unpaid_orders() returns int
language sql volatile as $$
  with x as (
    update orders set status = 'cancelled'
    where status = 'awaiting_payment' and created_at < now() - interval '15 minutes'
    returning 1
  ) select count(*)::int from x;
$$;

revoke all on function record_payment(text, text, text, int, text, boolean, jsonb) from public, anon, authenticated;
revoke all on function expire_unpaid_orders() from public, anon, authenticated;
