-- Measured stock is stored to three decimal places (kg/litre to g/ml).
-- Existing integer values retain their exact meaning. Older RPCs remain for
-- clients already using whole units; new RPC names prevent numeric overloads.
alter table public.products alter column current_stock type numeric(12,3),
  alter column low_stock_threshold type numeric(12,3);
alter table public.inventory_movements alter column quantity_delta type numeric(12,3);
alter table public.sale_items alter column quantity type numeric(12,3);
alter table public.products add constraint products_discrete_stock_whole
  check (lower(trim(unit)) in ('kg', 'g', 'litre', 'liter', 'ml', 'kilogram', 'gram', 'kilograms', 'grams', 'liters', 'litres') or current_stock = trunc(current_stock));

create function public.protect_product_unit_change() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.unit is distinct from new.unit and old.current_stock <> 0 then
    raise exception 'Reduce stock to zero before changing its unit' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger products_protect_unit_change before update of unit on public.products
  for each row execute function public.protect_product_unit_change();
revoke execute on function public.protect_product_unit_change() from public, anon, authenticated;

create function public.adjust_stock_decimal(
  p_shop_id uuid, p_product_id uuid, p_delta numeric, p_note text default null
) returns numeric language plpgsql security definer set search_path = '' as $$
declare v_product public.products%rowtype; v_stock numeric(12,3);
begin
  if (select auth.uid()) is null or not exists (
    select 1 from public.shops where id = p_shop_id and owner_id = (select auth.uid())
  ) then raise exception 'Not authorized for this shop' using errcode = '42501'; end if;
  if p_delta is null or p_delta = 0 or abs(p_delta) > 100000 or p_delta <> round(p_delta, 3) then
    raise exception 'Invalid stock quantity' using errcode = '22023';
  end if;
  select * into v_product from public.products
    where id = p_product_id and shop_id = p_shop_id and archived_at is null for update;
  if not found or v_product.current_stock + p_delta < 0 then
    raise exception 'Product missing or insufficient stock' using errcode = 'P0001';
  end if;
  if lower(trim(v_product.unit)) not in ('kg', 'g', 'litre', 'liter', 'ml', 'kilogram', 'gram', 'kilograms', 'grams', 'liters', 'litres') and p_delta <> trunc(p_delta) then
    raise exception 'Discrete items require whole quantities' using errcode = '22023';
  end if;
  update public.products set current_stock = current_stock + p_delta
    where id = p_product_id and shop_id = p_shop_id returning current_stock into v_stock;
  insert into public.inventory_movements(shop_id, product_id, movement_type, quantity_delta, note)
    values (p_shop_id, p_product_id, case when p_delta > 0 then 'restock' else 'adjustment' end, p_delta, nullif(trim(p_note), ''));
  return v_stock;
end;
$$;

create function public.adjust_stock_decimal_idempotent(
  p_shop_id uuid, p_request_key uuid, p_product_id uuid, p_delta numeric, p_note text default null
) returns numeric language plpgsql security definer set search_path = '' as $$
declare v_replay jsonb; v_stock numeric(12,3); v_payload jsonb;
begin
  v_payload := jsonb_build_object('productId', p_product_id, 'delta', p_delta, 'note', p_note);
  v_replay := public.claim_business_idempotency(p_shop_id, p_request_key, 'product.adjust', v_payload);
  if v_replay is not null then return (v_replay ->> 'stock')::numeric; end if;
  v_stock := public.adjust_stock_decimal(p_shop_id, p_product_id, p_delta, p_note);
  update public.business_idempotency set response = jsonb_build_object('stock', v_stock)
    where shop_id = p_shop_id and request_key = p_request_key;
  return v_stock;
end;
$$;

create function public.create_product_decimal_idempotent(
  p_shop_id uuid, p_request_key uuid, p_name text, p_sku text, p_unit text,
  p_selling_price numeric, p_cost_price numeric, p_threshold numeric, p_opening_stock numeric
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_replay jsonb; v_id uuid; v_payload jsonb;
begin
  v_payload := jsonb_build_object('name', p_name, 'sku', p_sku, 'unit', p_unit,
    'sellingPrice', p_selling_price, 'costPrice', p_cost_price,
    'threshold', p_threshold, 'openingStock', p_opening_stock);
  v_replay := public.claim_business_idempotency(p_shop_id, p_request_key, 'product.create', v_payload);
  if v_replay is not null then return (v_replay ->> 'id')::uuid; end if;
  if p_opening_stock is null or p_opening_stock < 0 or p_opening_stock > 100000
    or p_opening_stock <> round(p_opening_stock, 3)
    or p_threshold is null or p_threshold < 0 or p_threshold > 100000 or p_threshold <> round(p_threshold, 3)
    or p_selling_price is null or p_selling_price < 0 or p_selling_price > 999999999 or p_selling_price <> round(p_selling_price, 2)
    or (p_cost_price is not null and (p_cost_price < 0 or p_cost_price > 999999999 or p_cost_price <> round(p_cost_price, 2)))
    or (lower(trim(p_unit)) not in ('kg', 'g', 'litre', 'liter', 'ml', 'kilogram', 'gram', 'kilograms', 'grams', 'liters', 'litres') and (p_opening_stock <> trunc(p_opening_stock) or p_threshold <> trunc(p_threshold))) then
    raise exception 'Invalid product quantity or price' using errcode = '22023';
  end if;
  insert into public.products(shop_id, name, sku, unit, selling_price, cost_price, low_stock_threshold)
    values (p_shop_id, trim(p_name), nullif(trim(p_sku), ''), trim(p_unit), p_selling_price, p_cost_price, p_threshold)
    returning id into v_id;
  if p_opening_stock > 0 then
    perform public.adjust_stock_decimal(p_shop_id, v_id, p_opening_stock, 'Opening stock');
  end if;
  update public.business_idempotency set response = jsonb_build_object('id', v_id)
    where shop_id = p_shop_id and request_key = p_request_key;
  return v_id;
end;
$$;

create function public.record_sale_decimal_idempotent(
  p_shop_id uuid, p_request_key uuid, p_items jsonb, p_payment_method text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_replay jsonb; v_payload jsonb; v_item jsonb; v_product public.products%rowtype;
  v_product_id uuid; v_quantity numeric(12,3); v_line numeric; v_total numeric(12,2) := 0;
  v_sale_id uuid; v_seen uuid[] := '{}';
begin
  v_payload := jsonb_build_object('items', p_items, 'paymentMethod', p_payment_method);
  v_replay := public.claim_business_idempotency(p_shop_id, p_request_key, 'sale.record', v_payload);
  if v_replay is not null then return v_replay; end if;
  if p_payment_method is not null and p_payment_method not in ('cash', 'upi', 'card') then
    raise exception 'Invalid payment method' using errcode = '22023';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 30 then
    raise exception 'Choose between 1 and 30 sale items' using errcode = '22023';
  end if;
  insert into public.sales(shop_id, total_amount, payment_method)
    values (p_shop_id, 0, p_payment_method) returning id into v_sale_id;
  for v_item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item) <> 'object' or jsonb_typeof(v_item -> 'productId') <> 'string'
      or jsonb_typeof(v_item -> 'quantity') <> 'number'
      or (v_item ->> 'quantity') !~ '^[0-9]+(\.[0-9]{1,3})?$'
      or (v_item ? 'expectedUnitPrice' and jsonb_typeof(v_item -> 'expectedUnitPrice') <> 'number') then
      raise exception 'Invalid sale item' using errcode = '22023';
    end if;
    v_product_id := (v_item ->> 'productId')::uuid;
    v_quantity := (v_item ->> 'quantity')::numeric;
    if v_quantity <= 0 or v_quantity > 10000 or v_product_id = any(v_seen) then
      raise exception 'Invalid or duplicate sale item' using errcode = '22023';
    end if;
    v_seen := array_append(v_seen, v_product_id);
    select * into v_product from public.products
      where id = v_product_id and shop_id = p_shop_id and archived_at is null for update;
    if not found then raise exception 'Product not found' using errcode = 'P0002'; end if;
    if lower(trim(v_product.unit)) not in ('kg', 'g', 'litre', 'liter', 'ml', 'kilogram', 'gram', 'kilograms', 'grams', 'liters', 'litres') and v_quantity <> trunc(v_quantity) then
      raise exception 'Discrete items require whole quantities' using errcode = '22023';
    end if;
    if v_item ? 'expectedUnitPrice' and (v_item ->> 'expectedUnitPrice')::numeric <> v_product.selling_price then
      raise exception 'Product price changed; review the sale again' using errcode = 'P0003';
    end if;
    if v_product.current_stock < v_quantity then
      raise exception 'Insufficient stock for %', v_product.name using errcode = 'P0001';
    end if;
    v_line := v_quantity * v_product.selling_price;
    if v_line <> round(v_line, 2) or v_total + v_line > 999999999.99 then
      raise exception 'The line total cannot be recorded exactly in paise' using errcode = '22023';
    end if;
    update public.products set current_stock = current_stock - v_quantity where id = v_product_id;
    insert into public.sale_items(shop_id, sale_id, product_id, quantity, unit_price, line_total)
      values (p_shop_id, v_sale_id, v_product_id, v_quantity, v_product.selling_price, v_line);
    insert into public.inventory_movements(shop_id, product_id, movement_type, quantity_delta, note)
      values (p_shop_id, v_product_id, 'sale', -v_quantity, 'Sale ' || v_sale_id::text);
    v_total := v_total + v_line;
  end loop;
  update public.sales set total_amount = v_total where id = v_sale_id;
  v_replay := jsonb_build_object('saleId', v_sale_id, 'total', v_total);
  update public.business_idempotency set response = v_replay
    where shop_id = p_shop_id and request_key = p_request_key;
  return v_replay;
end;
$$;

revoke execute on function public.adjust_stock_decimal(uuid, uuid, numeric, text) from public, anon, authenticated;
revoke execute on function public.adjust_stock_decimal_idempotent(uuid, uuid, uuid, numeric, text) from public, anon;
revoke execute on function public.create_product_decimal_idempotent(uuid, uuid, text, text, text, numeric, numeric, numeric, numeric) from public, anon;
revoke execute on function public.record_sale_decimal_idempotent(uuid, uuid, jsonb, text) from public, anon;
grant execute on function public.adjust_stock_decimal_idempotent(uuid, uuid, uuid, numeric, text) to authenticated;
grant execute on function public.create_product_decimal_idempotent(uuid, uuid, text, text, text, numeric, numeric, numeric, numeric) to authenticated;
grant execute on function public.record_sale_decimal_idempotent(uuid, uuid, jsonb, text) to authenticated;
