-- create_order also records where the order came from (customer site or call centre) and which staff member
-- entered it. Same body as before otherwise; CREATE OR REPLACE keeps the existing (server-only) permissions.
create or replace function create_order(p_order jsonb, p_items jsonb) returns table (tracking_token text, number int, created boolean)
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
                      pickup_in_min, needs_call_confirm, client_ip, source, created_by)
  values ((p_order->>'branch_id')::uuid, next_order_number((p_order->>'branch_id')::uuid),
          encode(gen_random_bytes(16), 'hex'), (p_order->>'idempotency_key')::uuid,
          (p_order->>'type')::order_type, v_customer, p_order->>'customer_name', p_order->>'customer_phone',
          p_order->'address', (p_order->>'zone_id')::uuid, (p_order->>'subtotal')::int,
          (p_order->>'delivery_fee')::int, (p_order->>'total')::int, 'cash',
          (p_order->>'pickup_in_min')::int, coalesce((p_order->>'needs_call_confirm')::boolean, false),
          (p_order->>'client_ip')::inet, coalesce(p_order->>'source', 'web'), (p_order->>'created_by')::uuid)
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
